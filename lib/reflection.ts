import { chatComplete } from "./sarvam";
import type { Aggregation, InputType } from "./types";

// ── Public types ─────────────────────────────────────────────────────────────

export type ReflectionType =
  | "comparison"
  | "majority"
  | "minority"
  | "tribe"
  | "emotion";

export interface ReflectionResult {
  type: ReflectionType;
  copy: string;
  payload: Record<string, unknown>;
  source?: "llm" | "fallback";
}

export type NullReflectionReason = "no_data" | "no_signal" | "engine_error";

export interface PickReflectionResult {
  reflection: ReflectionResult | null;
  null_reason?: NullReflectionReason;
  debug_info?: string;
}

// ── Input shapes (loose — callers only need the fields used here) ────────────

interface QuestionInput {
  input_type: InputType;
}

interface AnswerInput {
  raw_value: unknown;
  normalized: { cluster: string; is_new: boolean; confidence: number } | null;
  sentiment: number | null;
}

// ── Internals ────────────────────────────────────────────────────────────────

interface Candidate {
  type: ReflectionType;
  score: number;
  minResponses: number;
  copy: string;
  payload: Record<string, unknown>;
}

type FallbackKey =
  | "emotion_divergent"
  | "emotion_aligned"
  | "majority"
  | "minority"
  | "tribe"
  | "comparison_high"
  | "comparison_low";

const FALLBACK_VARIANTS: Record<FallbackKey, string[]> = {
  emotion_divergent: [
    "Your read here goes against the grain",
    "Your reaction lands in a quieter corner of the room",
    "You're not where most landed on this one",
    "A less common feeling — yours stands out",
  ],
  emotion_aligned: [
    "You're in step with the room on this one",
    "Your read matches where most people landed",
    "You're not alone here — a shared feeling",
    "The room nodded along with your answer",
  ],
  majority: [
    "You picked the same as roughly {ratio} others",
    "{ratio} people landed where you did",
    "A common move — about {ratio} chose the same",
    "You're with the bigger group — {ratio} agreed",
    "Same call as {ratio} others before you",
  ],
  minority: [
    "Quieter corner — only about {ratio} went this direction",
    "Less traveled path — about {ratio} chose this",
    "An uncommon read — roughly {ratio} agreed",
    "You went somewhere only {ratio} did",
    "Smaller camp on this one — about {ratio} with you",
  ],
  tribe: [
    "You echo the {tribe} tribe — about {N} others felt similarly",
    "You sound like the {tribe} — {N} others arrived here too",
    "There's a {tribe} pattern in your answer — {N} share it",
    "You land with the {tribe} group — {N} others did",
  ],
  comparison_high: [
    "You're toward the upper end on this one",
    "Higher than most — your answer ranks near the top",
    "You sit on the bolder side of this question",
    "You're up where the room thins out",
  ],
  comparison_low: [
    "You're on the lower end — most lean higher",
    "Toward the gentler side of this question",
    "You're below where most folks landed",
    "A more reserved read than the room",
  ],
};

/** "cautiously-curious" → "Cautiously Curious" */
function humanizeClusterLabel(label: string): string {
  return label
    .split(/[-_\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function hashCode(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function ratioInTen(percent: number): string {
  const n = Math.max(1, Math.min(10, Math.round(percent / 10)));
  return `${n} in 10`;
}

function selectFallbackCopy(
  key: FallbackKey,
  payload: Record<string, unknown>,
  sessionId: string,
  questionPosition: number
): string {
  const variants = FALLBACK_VARIANTS[key];
  const idx = (hashCode(sessionId) + questionPosition) % variants.length;
  return variants[idx]
    .replace(/\{ratio\}/g, String(payload.ratio ?? "a few"))
    .replace(/\{tribe\}/g, String(payload.clusterLabelHumanized ?? payload.clusterLabel ?? "similar"))
    .replace(/\{N\}/g, String(payload.clusterCount ?? 0));
}

function sign(value: number): -1 | 0 | 1 {
  if (value > 0) return 1;
  if (value < 0) return -1;
  return 0;
}

// ── Main entry ───────────────────────────────────────────────────────────────

/**
 * Pick the best social reflection for this answer.
 *
 * @param question  – only `input_type` is read
 * @param answer    – `raw_value`, `normalized`, `sentiment`
 * @param aggregation – the pre-answer aggregation row used for comparison
 * @param sessionHistory – reflection types shown for recent questions in this
 *   session.  If this type appeared in the last 2 entries, its score is halved.
 *
 * @returns the winning reflection, or `null` when nothing clears its threshold.
 */
export function pickReflection(
  question: QuestionInput,
  answer: AnswerInput,
  aggregation: Aggregation,
  sessionHistory: string[]
): ReflectionResult | null {
  return pickReflectionWithDebug(question, answer, aggregation, sessionHistory).reflection;
}

export function pickReflectionWithDebug(
  question: QuestionInput,
  answer: AnswerInput,
  aggregation: Aggregation,
  sessionHistory: string[],
  options: { sessionId?: string; questionPosition?: number } = {}
): PickReflectionResult {
  const inputType = question.input_type;
  const total = aggregation.total_responses;
  const dist = aggregation.distribution;
  const rv = answer.raw_value as Record<string, unknown>;
  const candidates: Candidate[] = [];
  const sessionId = options.sessionId ?? "";
  const questionPosition = options.questionPosition ?? 0;

  // ── comparison [emoji_slider, ranking] ─────────────────────────────────────

  if (inputType === "emoji_slider") {
    const val = rv.value as number;

    const BUCKETS = ["0-20", "20-40", "40-60", "60-80", "80-100"] as const;
    const bucketStart = val >= 100 ? 80 : Math.floor(val / 20) * 20;
    const valBucket = `${bucketStart}-${bucketStart + 20}`;

    // Approximate percentile: count everyone in lower buckets + half of own bucket
    let below = 0;
    for (const b of BUCKETS) {
      if (b === valBucket) {
        below += Math.max(0, (dist[b] ?? 0) - 1) / 2;
        break;
      }
      below += dist[b] ?? 0;
    }
    const pct = total > 0 ? Math.round((below / total) * 100) : 50;
    const score = Math.abs(pct - 50) / 50;
    const direction = pct >= 50 ? "high" : "low";
    const payload = {
      percentile: pct,
      value: val,
      bucket: valBucket,
      direction,
      distribution: { ...dist },
      totalResponses: total,
    };

    candidates.push({
      type: "comparison",
      score,
      minResponses: 10,
      copy: selectFallbackCopy(
        direction === "high" ? "comparison_high" : "comparison_low",
        payload,
        sessionId,
        questionPosition
      ),
      payload,
    });
  }

  if (inputType === "ranking") {
    const ranked = rv.value as string[];
    if (ranked.length > 1) {
      const topPick = ranked[0];
      const avgPos = dist[topPick] ?? 1;
      const maxPos = ranked.length;
      // Higher avgPos for user's #1 pick ⇒ more contrarian ⇒ higher score
      const score = Math.abs(avgPos - 1) / (maxPos - 1 || 1);

      // Treat avgPos as a pseudo-percentile: 1 = top, maxPos = bottom
      const pct = Math.round(((avgPos - 1) / (maxPos - 1 || 1)) * 100);

      const direction = pct < 50 ? "high" : "low";
      const payload = { percentile: pct, topPick, avgPosition: avgPos, totalOptions: maxPos, direction };

      candidates.push({
        type: "comparison",
        score,
        minResponses: 10,
        copy: selectFallbackCopy(
          direction === "high" ? "comparison_high" : "comparison_low",
          payload,
          sessionId,
          questionPosition
        ),
        payload,
      });
    }
  }

  // ── majority [cards, this_or_that, visual_select] ─────────────────────────

  if (
    inputType === "cards" ||
    inputType === "this_or_that" ||
    inputType === "visual_select"
  ) {
    const chosen = rv.value as string;

    let maxLabel = "";
    let maxCount = 0;
    for (const [label, count] of Object.entries(dist)) {
      if (count > maxCount) {
        maxLabel = label;
        maxCount = count;
      }
    }

    const dominantFraction = total > 0 ? maxCount / total : 0;

    if (chosen === maxLabel && dominantFraction >= 0.3) {
      const pct = Math.round(dominantFraction * 100);
      const payload = {
        chosen,
        chosenPct: pct,
        ratio: ratioInTen(pct),
        totalResponses: total,
        distribution: { ...dist },
      };
      candidates.push({
        type: "majority",
        score: dominantFraction,
        minResponses: 8,
        copy: selectFallbackCopy("majority", payload, sessionId, questionPosition),
        payload,
      });
    }
  }

  // ── minority [cards, this_or_that, visual_select] ─────────────────────────

  if (
    inputType === "cards" ||
    inputType === "this_or_that" ||
    inputType === "visual_select"
  ) {
    const chosen = rv.value as string;
    const chosenCount = dist[chosen] ?? 0;

    if (total > 0 && chosenCount > 0) {
      const pct = Math.round((chosenCount / total) * 100);
      if (pct < 25) {
        const payload = {
          chosen,
          chosenPct: pct,
          ratio: ratioInTen(pct),
          totalResponses: total,
          distribution: { ...dist },
        };
        candidates.push({
          type: "minority",
          score: 1 - chosenCount / total,
          minResponses: 8,
          copy: selectFallbackCopy("minority", payload, sessionId, questionPosition),
          payload,
        });
      }
    }
  }

  // ── tribe [voice, text] ────────────────────────────────────────────────────

  if (
    (inputType === "voice" || inputType === "text") &&
    answer.normalized
  ) {
    const clusterLabel = answer.normalized.cluster;
    const matched = aggregation.clusters.find((c) => c.label === clusterLabel);

    if (matched && matched.count >= 2) {
      const payload = {
        clusterLabel,
        clusterLabelHumanized: humanizeClusterLabel(clusterLabel),
        clusterCount: matched.count,
        totalResponses: total,
      };
      candidates.push({
        type: "tribe",
        score: matched.count / total,
        minResponses: 5,
        copy: selectFallbackCopy("tribe", payload, sessionId, questionPosition),
        payload,
      });
    }
  }

  // ── emotion [any input type, needs sentiment] ──────────────────────────────

  if (answer.sentiment !== null && total >= 5) {
    const diff = Math.abs(answer.sentiment - aggregation.sentiment_avg);
    if (diff >= 0.25) {
      const aligned =
        sign(answer.sentiment) !== 0 &&
        sign(answer.sentiment) === sign(aggregation.sentiment_avg) &&
        diff < 0.25;
      const payload = {
        answerSentiment: answer.sentiment,
        avgSentiment: aggregation.sentiment_avg,
        divergence: diff,
        aligned,
      };

      candidates.push({
        type: "emotion",
        score: diff,
        minResponses: 5,
        copy: selectFallbackCopy(
          aligned ? "emotion_aligned" : "emotion_divergent",
          payload,
          sessionId,
          questionPosition
        ),
        payload,
      });
    }
  }

  // ── Pick winner with recency penalty ───────────────────────────────────────

  const recentSet = new Set(sessionHistory.slice(-2));
  let bestScore = -1;
  let best: Candidate | null = null;

  for (const c of candidates) {
    if (total < c.minResponses) continue;
    const adjusted = recentSet.has(c.type) ? c.score * 0.5 : c.score;
    if (adjusted > bestScore) {
      bestScore = adjusted;
      best = c;
    }
  }

  if (!best || bestScore < 0) {
    if (candidates.length > 0) {
      const needed = Math.min(...candidates.map((c) => c.minResponses));
      return {
        reflection: null,
        null_reason: "no_data",
        debug_info: `only ${total} responses, need ${needed}+`,
      };
    }

    return {
      reflection: null,
      null_reason: total < 5 ? "no_data" : "no_signal",
      debug_info:
        total < 5
          ? `only ${total} responses, need 5+`
          : "data exists, but no candidate cleared signal thresholds",
    };
  }

  return {
    reflection: {
      type: best.type,
      copy: best.copy,
      payload: best.payload,
      source: "fallback",
    },
  };
}

export async function generateReflectionCopy(
  type: ReflectionType,
  payload: Record<string, unknown>,
  context: { questionPrompt: string; answerText?: string }
): Promise<string | null> {
  const answerLine = context.answerText?.trim()
    ? `Their answer: ${context.answerText.trim()}`
    : null;

  const systemPrompt = [
    "You generate a single short reflection for someone who just answered a question. The reflection shows them how their answer compares to others — making them feel seen.",
    "",
    "Style:",
    "- 1-2 sentences, max 22 words",
    "- Evocative, never formulaic. Vary phrasing each time",
    "- Weave numbers naturally — never lead with raw percentages",
    "- Don't say 'the crowd' or 'most people' as filler",
    "- Match the energy of the question being asked",
    "",
    `Reflection type: ${type}`,
    `Question they answered: ${context.questionPrompt}`,
    answerLine,
    `Comparison data: ${JSON.stringify(payload)}`,
    "",
    "Output ONLY the reflection text. No preamble, no quotes, no markdown.",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  try {
    const result = await Promise.race([
      chatComplete(
        [{ role: "system", content: systemPrompt }],
        {
          model: "sarvam-30b",
          temperature: 0.85,
          max_tokens: 60,
          top_p: 1,
          extra_body: {
            chat_template_kwargs: {
              enable_thinking: false,
            },
          },
        }
      ),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500)),
    ]);

    if (!result) return null;
    const text = result.choices?.[0]?.message?.content?.trim() ?? "";
    return text.replace(/^["']|["']$/g, "").trim() || null;
  } catch {
    return null;
  }
}
