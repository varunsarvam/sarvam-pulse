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

/** "cautiously-curious" → "Cautiously Curious" */
function humanizeClusterLabel(label: string): string {
  return label
    .split(/[-_\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

// ── Main entry ───────────────────────────────────────────────────────────────

/**
 * Pick the best social reflection for this answer.
 *
 * @param question  – only `input_type` is read
 * @param answer    – `raw_value`, `normalized`, `sentiment`
 * @param aggregation – the *already-updated* aggregation row (includes this answer)
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
  const inputType = question.input_type;
  const total = aggregation.total_responses;
  const dist = aggregation.distribution;
  const rv = answer.raw_value as Record<string, unknown>;
  const candidates: Candidate[] = [];

  // ── comparison [emoji_slider, ranking] — threshold 20 ──────────────────────

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

    candidates.push({
      type: "comparison",
      score,
      minResponses: 1,
      copy:
        pct >= 50
          ? `You're in the top ${100 - pct}% on this`
          : `You're in the bottom ${pct}% — most lean higher`,
      payload: { percentile: pct, value: val, bucket: valBucket },
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

      candidates.push({
        type: "comparison",
        score,
        minResponses: 1,
        copy:
          pct < 50
            ? `You're in the top ${100 - pct}% on this`
            : `You're in the bottom ${pct}% — most lean higher`,
        payload: { percentile: pct, topPick, avgPosition: avgPos, totalOptions: maxPos },
      });
    }
  }

  // ── majority [cards, this_or_that, visual_select] — threshold 15 ───────────

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
      candidates.push({
        type: "majority",
        score: dominantFraction,
        minResponses: 1,
        copy: `${pct}% of people also chose ${chosen}`,
        payload: { chosen, chosenPct: pct, totalResponses: total },
      });
    }
  }

  // ── minority [cards, this_or_that, visual_select] — threshold 15 ───────────

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
        candidates.push({
          type: "minority",
          score: 1 - chosenCount / total,
          minResponses: 2,
          copy: `Only ${pct}% chose this — you're in rare company`,
          payload: { chosen, chosenPct: pct, totalResponses: total },
        });
      }
    }
  }

  // ── tribe [voice, text] — threshold 30, cluster ≥ 5 members ────────────────

  if (
    (inputType === "voice" || inputType === "text") &&
    answer.normalized
  ) {
    const clusterLabel = answer.normalized.cluster;
    const matched = aggregation.clusters.find((c) => c.label === clusterLabel);

    if (matched && matched.count >= 2) {
      candidates.push({
        type: "tribe",
        score: matched.count / total,
        minResponses: 3,
        copy: `You sound like the ${humanizeClusterLabel(clusterLabel)} — ${matched.count} others felt the same`,
        payload: {
          clusterLabel,
          clusterLabelHumanized: humanizeClusterLabel(clusterLabel),
          clusterCount: matched.count,
          totalResponses: total,
        },
      });
    }
  }

  // ── emotion [any input type, needs sentiment] — threshold 15 ───────────────

  if (answer.sentiment !== null) {
    const diff = Math.abs(answer.sentiment - aggregation.sentiment_avg);
    const aligned =
      answer.sentiment * aggregation.sentiment_avg > 0 && diff < 0.3;

    candidates.push({
      type: "emotion",
      score: diff,
      minResponses: 1,
      copy: aligned
        ? "Most people leaned positive here, like you"
        : "Your tone stands apart from the crowd",
      payload: {
        answerSentiment: answer.sentiment,
        avgSentiment: aggregation.sentiment_avg,
        divergence: diff,
        aligned,
      },
    });
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

  if (!best || bestScore < 0) return null;
  return { type: best.type, copy: best.copy, payload: best.payload };
}
