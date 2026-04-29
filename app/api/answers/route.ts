import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { normalizeAnswer, type NormalizeResult } from "@/lib/llm";
import { pickReflection } from "@/lib/reflection";
import type { InputType, Aggregation, Cluster } from "@/lib/types";

// ── Helpers ──────────────────────────────────────────────────────────────────

function sliderBucket(val: number): string {
  const start = val >= 100 ? 80 : Math.floor(val / 20) * 20;
  return `${start}-${start + 20}`;
}

function extractAnswerText(
  rawValue: Record<string, unknown>,
  transcript: string | null
): string {
  return (transcript ?? (rawValue.value as string) ?? "").trim();
}

function defaultAggregation(questionId: string): Aggregation {
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

// ── Route ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { session_id, question_id, raw_value, transcript } =
      (await req.json()) as {
        session_id?: string;
        question_id?: string;
        raw_value?: Record<string, unknown>;
        transcript?: string | null;
      };

    if (!session_id || !question_id || raw_value === undefined) {
      return NextResponse.json(
        { error: "session_id, question_id, and raw_value are required." },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    // ── Phase 1: insert answer + fetch question + read aggregation (parallel) ─

    const [insertRes, questionRes, aggRes] = await Promise.all([
      supabase
        .from("answers")
        .insert({
          session_id,
          question_id,
          raw_value,
          transcript: transcript ?? null,
        })
        .select("id")
        .single(),
      supabase
        .from("questions")
        .select("input_type, intent, options, position, form_id")
        .eq("id", question_id)
        .single(),
      supabase
        .from("aggregations")
        .select("*")
        .eq("question_id", question_id)
        .maybeSingle(),
    ]);

    if (insertRes.error) {
      console.error("answers insert error:", insertRes.error);
      return NextResponse.json(
        { error: insertRes.error.message },
        { status: 500 }
      );
    }
    if (questionRes.error || !questionRes.data) {
      console.error("question fetch error:", questionRes.error);
      return NextResponse.json(
        { error: "Question not found." },
        { status: 404 }
      );
    }

    const answerId = insertRes.data.id as string;
    const question = questionRes.data as {
      input_type: InputType;
      intent: string | null;
      options: unknown;
      position: number;
      form_id: string;
    };
    const inputType = question.input_type;
    const isOpenEnded = inputType === "voice" || inputType === "text";

    // ── Phase 2: normalize (voice/text only, needs existing clusters) ─────────

    let normalizeResult: NormalizeResult | null = null;

    if (isOpenEnded) {
      const answerText = extractAnswerText(raw_value, transcript ?? null);
      if (answerText) {
        const existingClusters = (
          ((aggRes.data?.clusters ?? []) as Cluster[])
        ).map((c) => c.label);
        normalizeResult = await normalizeAnswer(
          answerText,
          question.intent,
          existingClusters
        );
      }
    }

    // ── Phase 3: compute updated aggregation ──────────────────────────────────

    const agg: Aggregation = aggRes.data
      ? (aggRes.data as Aggregation)
      : defaultAggregation(question_id);

    const oldTotal = agg.total_responses;
    agg.total_responses = oldTotal + 1;
    const newTotal = agg.total_responses;

    switch (inputType) {
      case "cards":
      case "this_or_that":
      case "visual_select": {
        const chosen = raw_value.value as string;
        agg.distribution[chosen] = (agg.distribution[chosen] ?? 0) + 1;
        break;
      }

      case "emoji_slider": {
        const bucket = sliderBucket(raw_value.value as number);
        agg.distribution[bucket] = (agg.distribution[bucket] ?? 0) + 1;
        break;
      }

      case "ranking": {
        const ranked = raw_value.value as string[];
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
        if (normalizeResult) {
          if (normalizeResult.is_new) {
            agg.clusters.push({
              label: normalizeResult.cluster,
              count: 1,
              examples: [
                extractAnswerText(raw_value, transcript ?? null).slice(0, 120),
              ],
            });
          } else {
            const match = agg.clusters.find(
              (c) => c.label === normalizeResult.cluster
            );
            if (match) {
              match.count += 1;
              if (match.examples.length < 5) {
                match.examples.push(
                  extractAnswerText(raw_value, transcript ?? null).slice(0, 120)
                );
              }
            } else {
              agg.clusters.push({
                label: normalizeResult.cluster,
                count: 1,
                examples: [
                  extractAnswerText(raw_value, transcript ?? null).slice(
                    0,
                    120
                  ),
                ],
              });
            }
          }
        }
        break;
      }
    }

    // Sentiment rolling average (only when we have a sentiment score)
    if (normalizeResult) {
      agg.sentiment_avg =
        (agg.sentiment_avg * oldTotal + normalizeResult.sentiment) / newTotal;
    }

    // Recent quotes — prepend, keep 10, skip if nothing quotable
    const quote = extractAnswerText(raw_value, transcript ?? null).slice(0, 80);
    if (quote) {
      agg.recent_quotes = [quote, ...agg.recent_quotes].slice(0, 10);
    }

    agg.updated_at = new Date().toISOString();

    // ── Phase 4: persist aggregation + answer update + next question (parallel)

    const writeOps: Promise<unknown>[] = [
      supabase.from("aggregations").upsert({
        question_id: agg.question_id,
        total_responses: agg.total_responses,
        distribution: agg.distribution,
        sentiment_avg: agg.sentiment_avg,
        recent_quotes: agg.recent_quotes,
        clusters: agg.clusters,
        updated_at: agg.updated_at,
      }),

      supabase
        .from("questions")
        .select("id")
        .eq("form_id", question.form_id)
        .gt("position", question.position)
        .order("position", { ascending: true })
        .limit(1)
        .maybeSingle(),
    ];

    if (normalizeResult) {
      writeOps.push(
        supabase
          .from("answers")
          .update({
            normalized: {
              cluster: normalizeResult.cluster,
              is_new: normalizeResult.is_new,
              confidence: normalizeResult.confidence,
            },
            sentiment: normalizeResult.sentiment,
          })
          .eq("id", answerId)
      );
    }

    const [, nextQRes] = (await Promise.all(writeOps)) as [
      unknown,
      { data: { id: string } | null },
      ...unknown[],
    ];

    // ── Phase 5: compute reflection ───────────────────────────────────────────

    const reflection = pickReflection(
      { input_type: inputType },
      {
        raw_value,
        normalized: normalizeResult
          ? {
              cluster: normalizeResult.cluster,
              is_new: normalizeResult.is_new,
              confidence: normalizeResult.confidence,
            }
          : null,
        sentiment: normalizeResult?.sentiment ?? null,
      },
      agg,
      [] // session-level history tracked client-side; empty for now
    );

    // ── Phase 6: return ───────────────────────────────────────────────────────

    return NextResponse.json({
      reflection,
      next_question_id: nextQRes?.data?.id ?? null,
    });
  } catch (e) {
    console.error("answers route error:", e);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 }
    );
  }
}
