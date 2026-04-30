import { createAdminClient } from "./supabase/server";
import { normalizeAnswer, type NormalizeResult } from "./llm";
import type { Aggregation, InputType } from "./types";

/**
 * Aggregation library — single source of truth for the per-question rollup
 * the live ENTRY screen and the reflection engine read from.
 *
 * `computeAggregationUpdate()` is the pure function that takes (current row,
 * one new answer) and returns the next row. The route handler in
 * `/api/answers` and the Phase 3 → 4 seed pipeline in `/api/forms/generate`
 * both call it.
 *
 * `seedAggregations()` bulk-runs `computeAggregationUpdate` over all of a
 * form's seed answers right after Phase 3 persistence, so a freshly-created
 * form has fully-populated aggregation rows from session 1.
 */

// =============================================================================
// Helpers (lifted from app/api/answers/route.ts; this is now their home)
// =============================================================================

/**
 * Map a 0–100 slider value to a 20-wide bucket label, e.g. 47 → "40-60".
 * 100 collapses into the "80-100" bucket (the right edge is closed).
 */
export function sliderBucket(val: number): string {
  const start = val >= 100 ? 80 : Math.floor(val / 20) * 20;
  return `${start}-${start + 20}`;
}

export function defaultAggregation(questionId: string): Aggregation {
  return {
    question_id: questionId,
    total_responses: 0,
    distribution: {},
    sentiment_avg: 0,
    recent_quotes: [],
    clusters: [],
    updated_at: new Date().toISOString(),
  };
}

export function cloneAggregation(agg: Aggregation): Aggregation {
  return {
    question_id: agg.question_id,
    total_responses: agg.total_responses,
    distribution: { ...agg.distribution },
    sentiment_avg: agg.sentiment_avg,
    recent_quotes: [...agg.recent_quotes],
    clusters: agg.clusters.map((c) => ({
      label: c.label,
      count: c.count,
      examples: [...c.examples],
    })),
    updated_at: agg.updated_at,
  };
}

export function extractAnswerText(
  rawValue: Record<string, unknown>,
  transcript: string | null
): string {
  if (transcript?.trim()) return transcript.trim();
  const value = rawValue.value;
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.join(" → ");
  return "";
}

// =============================================================================
// Pure computation
// =============================================================================

export interface AnswerInput {
  input_type: InputType;
  raw_value: Record<string, unknown>;
  transcript: string | null;
  /** Result from `normalizeAnswer()`, if available. Voice/text only. */
  normalized: { cluster: string; is_new: boolean; confidence: number } | null;
  /** Sentiment from `normalizeAnswer()`, if available. */
  sentiment: number | null;
}

/**
 * Pure function: takes the current aggregation row (or null) and one new
 * answer, returns the next aggregation row. Does NOT touch the DB; the caller
 * persists. Behaviour mirrors the prior inline logic in `/api/answers` exactly
 * — switch on input_type, rolling sentiment average, prepend-and-trim recent
 * quotes, find-or-push clusters.
 */
export function computeAggregationUpdate(
  current: Aggregation | null,
  questionId: string,
  answer: AnswerInput
): Aggregation {
  const base = current ?? defaultAggregation(questionId);
  const agg = cloneAggregation(base);
  const oldTotal = agg.total_responses;
  agg.total_responses = oldTotal + 1;
  const newTotal = agg.total_responses;

  const rawValue = answer.raw_value;

  switch (answer.input_type) {
    case "cards":
    case "this_or_that":
    case "visual_select": {
      const chosen = rawValue.value as string;
      agg.distribution[chosen] = (agg.distribution[chosen] ?? 0) + 1;
      break;
    }

    case "emoji_slider": {
      const bucket = sliderBucket(rawValue.value as number);
      agg.distribution[bucket] = (agg.distribution[bucket] ?? 0) + 1;
      break;
    }

    case "ranking": {
      const ranked = rawValue.value as string[];
      for (let i = 0; i < ranked.length; i++) {
        const option = ranked[i];
        const position = i + 1;
        const oldAvg = agg.distribution[option] ?? position;
        agg.distribution[option] =
          (oldAvg * oldTotal + position) / newTotal;
      }
      break;
    }

    case "voice":
    case "text": {
      if (answer.normalized) {
        if (answer.normalized.is_new) {
          agg.clusters.push({
            label: answer.normalized.cluster,
            count: 1,
            examples: [
              extractAnswerText(rawValue, answer.transcript).slice(0, 120),
            ],
          });
        } else {
          const match = agg.clusters.find(
            (c) => c.label === answer.normalized!.cluster
          );
          if (match) {
            match.count += 1;
            if (match.examples.length < 5) {
              match.examples.push(
                extractAnswerText(rawValue, answer.transcript).slice(0, 120)
              );
            }
          } else {
            agg.clusters.push({
              label: answer.normalized.cluster,
              count: 1,
              examples: [
                extractAnswerText(rawValue, answer.transcript).slice(0, 120),
              ],
            });
          }
        }
      }
      break;
    }

    case "name": {
      // Name questions never aggregate. Caller should also intercept these
      // upstream (the answers route does), but we no-op defensively here.
      break;
    }
  }

  // Rolling sentiment average — only when we have a new sentiment score.
  if (answer.sentiment !== null && answer.sentiment !== undefined) {
    agg.sentiment_avg =
      (agg.sentiment_avg * oldTotal + answer.sentiment) / newTotal;
  }

  // Recent quotes — prepend, keep last 10. Only quotable text qualifies.
  const quote = extractAnswerText(rawValue, answer.transcript).slice(0, 80);
  if (quote) {
    agg.recent_quotes = [quote, ...agg.recent_quotes].slice(0, 10);
  }

  agg.updated_at = new Date().toISOString();

  return agg;
}

// =============================================================================
// Seed aggregations (Phase 4)
// =============================================================================

export interface SeedAnswerWithMeta {
  session_id: string;
  question_id: string;
  raw_value: Record<string, unknown>;
  transcript: string | null;
  input_type: InputType;
}

export interface SeedAggregationQuestion {
  id: string;
  input_type: InputType;
  intent: string | null;
}

/**
 * Bulk-compute aggregations for a freshly-seeded form. For each question:
 * 1. Filter the in-memory seed answers down to that question.
 * 2. (Voice/text only, when `backfillSentiment`) call `normalizeAnswer()`
 *    sequentially over the answers so the cluster list grows and the LLM can
 *    reuse labels across answers (parallelizing within a question would
 *    fragment clusters since each call would see an empty list).
 *    Across questions we run in parallel — clusters are per-question anyway.
 * 3. Fold via `computeAggregationUpdate`, starting from the empty default.
 * 4. Upsert the final aggregation row.
 */
export async function seedAggregations(
  formId: string,
  questions: SeedAggregationQuestion[],
  seedAnswers: SeedAnswerWithMeta[],
  options: { backfillSentiment?: boolean } = {}
): Promise<{ aggregations_created: number; normalize_calls: number }> {
  console.time("phase-4:seed-aggregations:total");
  const supabase = createAdminClient();
  const backfillSentiment = options.backfillSentiment ?? true;
  void formId; // accepted for symmetry with other seed funcs; not needed here

  // Group answers by question for O(1) lookup.
  const answersByQuestion = new Map<string, SeedAnswerWithMeta[]>();
  for (const a of seedAnswers) {
    const arr = answersByQuestion.get(a.question_id) ?? [];
    arr.push(a);
    answersByQuestion.set(a.question_id, arr);
  }

  let normalizeCalls = 0;

  const perQuestion = await Promise.allSettled(
    questions.map(async (q) => {
      if (q.input_type === "name") return null;
      const qAnswers = answersByQuestion.get(q.id) ?? [];
      if (qAnswers.length === 0) return null;

      const qLabel = `phase-4:agg:${q.input_type}:${q.id.slice(0, 8)}`;
      console.time(qLabel);

      let normalizeResults: Array<NormalizeResult | null> = [];

      if (
        backfillSentiment &&
        (q.input_type === "voice" || q.input_type === "text")
      ) {
        const normLabel = `phase-4:normalize:${q.id.slice(0, 8)}`;
        console.time(normLabel);
        const existingClusters: string[] = [];
        normalizeResults = [];
        // Sequential within a question so cluster labels can be reused.
        for (const a of qAnswers) {
          const text = extractAnswerText(a.raw_value, a.transcript);
          if (!text) {
            normalizeResults.push(null);
            continue;
          }
          try {
            const result = await normalizeAnswer(text, q.intent, [
              ...existingClusters,
            ]);
            normalizeCalls += 1;
            if (!existingClusters.includes(result.cluster)) {
              existingClusters.push(result.cluster);
            }
            normalizeResults.push(result);
          } catch (err) {
            console.error(
              `[seed-aggregations] normalize error for question ${q.id}:`,
              err instanceof Error ? err.message : err
            );
            normalizeResults.push(null);
          }
        }
        console.timeEnd(normLabel);
      }

      let current: Aggregation | null = null;
      for (let i = 0; i < qAnswers.length; i++) {
        const a = qAnswers[i];
        const norm = normalizeResults[i] ?? null;
        const answerInput: AnswerInput = {
          input_type: q.input_type,
          raw_value: a.raw_value,
          transcript: a.transcript,
          normalized: norm
            ? {
                cluster: norm.cluster,
                is_new: norm.is_new,
                confidence: norm.confidence,
              }
            : null,
          sentiment: norm?.sentiment ?? null,
        };
        current = computeAggregationUpdate(current, q.id, answerInput);
      }

      console.timeEnd(qLabel);
      return current;
    })
  );

  // Upsert each computed aggregation.
  let aggregationsCreated = 0;
  for (const result of perQuestion) {
    if (result.status !== "fulfilled" || !result.value) continue;
    const agg = result.value;
    const { error } = await supabase.from("aggregations").upsert({
      question_id: agg.question_id,
      total_responses: agg.total_responses,
      distribution: agg.distribution,
      sentiment_avg: agg.sentiment_avg,
      recent_quotes: agg.recent_quotes,
      clusters: agg.clusters,
      updated_at: agg.updated_at,
    });
    if (error) {
      console.error(
        `[seed-aggregations] upsert error for question ${agg.question_id}:`,
        error
      );
    } else {
      aggregationsCreated += 1;
    }
  }

  console.log(
    `[seed-aggregations] ${aggregationsCreated}/${questions.filter((q) => q.input_type !== "name").length} aggregations seeded; ${normalizeCalls} normalize calls`
  );
  console.timeEnd("phase-4:seed-aggregations:total");

  return { aggregations_created: aggregationsCreated, normalize_calls: normalizeCalls };
}
