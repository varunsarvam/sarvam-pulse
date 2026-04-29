import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { chatComplete } from "@/lib/sarvam";
import type { Aggregation } from "@/lib/types";

interface IdentityResult {
  label: string;
  summary: string;
  highlights: string[];
}

interface PercentileEntry {
  question_id: string;
  question_prompt: string;
  user_value: number;
  percentile: number;
}

interface AnswerWithQuestion {
  raw_value: { type?: string; value?: unknown } | null;
  transcript: string | null;
  normalized: { cluster?: string } | null;
  questions: {
    id: string;
    prompt: string;
    input_type: string;
  } | null;
}

interface SessionNameRow {
  respondent_name: string | null;
}

function extractAnswerText(
  raw: { type?: string; value?: unknown } | null,
  transcript: string | null
): string {
  if (transcript && transcript.trim()) return transcript.trim();
  if (!raw) return "";
  const v = raw.value;
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return v.join(" → ");
  return JSON.stringify(v ?? "");
}

function parseIdentity(raw: string): IdentityResult | null {
  const cleaned = raw
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (
      typeof parsed.label === "string" &&
      typeof parsed.summary === "string" &&
      Array.isArray(parsed.highlights)
    ) {
      return {
        label: parsed.label,
        summary: parsed.summary,
        highlights: parsed.highlights
          .filter((h: unknown): h is string => typeof h === "string")
          .slice(0, 3),
      };
    }
  } catch {
    // Try to extract JSON object via regex
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        if (
          typeof parsed.label === "string" &&
          typeof parsed.summary === "string" &&
          Array.isArray(parsed.highlights)
        ) {
          return {
            label: parsed.label,
            summary: parsed.summary,
            highlights: parsed.highlights
              .filter((h: unknown): h is string => typeof h === "string")
              .slice(0, 3),
          };
        }
      } catch {
        // fall through
      }
    }
  }
  return null;
}

function fallbackIdentity(): IdentityResult {
  return {
    label: "Quiet Observer",
    summary:
      "You took the time to share thoughtful answers — your perspective is uniquely yours.",
    highlights: [
      "Engaged with every question",
      "Brought a thoughtful voice",
      "Made it through the whole form",
    ],
  };
}

/**
 * Compute percentile of a value within an emoji_slider distribution histogram.
 * Distribution is bucketed: { "0-20": n, "20-40": n, ... }.
 * Returns 0-100 (where this user's value falls relative to others).
 */
function computeSliderPercentile(
  userValue: number,
  distribution: Record<string, number>
): number {
  const buckets: { range: [number, number]; count: number }[] = [
    { range: [0, 20], count: distribution["0-20"] ?? 0 },
    { range: [20, 40], count: distribution["20-40"] ?? 0 },
    { range: [40, 60], count: distribution["40-60"] ?? 0 },
    { range: [60, 80], count: distribution["60-80"] ?? 0 },
    { range: [80, 100], count: distribution["80-100"] ?? 0 },
  ];

  const total = buckets.reduce((s, b) => s + b.count, 0);
  if (total === 0) return 50;

  let below = 0;
  for (const b of buckets) {
    if (userValue >= b.range[1]) {
      below += b.count;
    } else if (userValue >= b.range[0]) {
      // Partial bucket: interpolate within
      const frac = (userValue - b.range[0]) / (b.range[1] - b.range[0]);
      below += b.count * frac;
      break;
    }
  }
  return Math.round((below / total) * 100);
}

export async function POST(req: NextRequest) {
  try {
    const { session_id } = (await req.json()) as { session_id?: string };

    if (!session_id) {
      return NextResponse.json(
        { error: "session_id is required" },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    const { data: sessionData } = await supabase
      .from("sessions")
      .select("respondent_name")
      .eq("id", session_id)
      .maybeSingle();
    const respondentName =
      typeof (sessionData as SessionNameRow | null)?.respondent_name === "string"
        ? (sessionData as SessionNameRow).respondent_name
        : null;

    // ── Phase 1: Fetch all answers joined with their question ──
    const { data: answersData, error: answersError } = await supabase
      .from("answers")
      .select(
        `
        raw_value,
        transcript,
        normalized,
        questions ( id, prompt, input_type )
      `
      )
      .eq("session_id", session_id)
      .order("created_at", { ascending: true });

    if (answersError) {
      console.error("[complete-session] fetch answers error:", answersError);
      return NextResponse.json(
        { error: "Failed to fetch answers" },
        { status: 500 }
      );
    }

    const answers = (answersData ?? []) as unknown as AnswerWithQuestion[];

    if (answers.length === 0) {
      return NextResponse.json(
        { error: "No answers found for this session" },
        { status: 404 }
      );
    }

    // ── Phase 2: Build context for the LLM ──
    const contextPairs = answers
      .filter((a) => a.questions !== null)
      .map((a) => ({
        question: a.questions!.prompt,
        answer: extractAnswerText(a.raw_value, a.transcript),
        normalized_cluster: a.normalized?.cluster ?? null,
      }))
      .filter((p) => p.answer.length > 0);

    const userMessage = contextPairs
      .map((p, i) => {
        const cluster = p.normalized_cluster
          ? ` [theme: ${p.normalized_cluster}]`
          : "";
        return `Q${i + 1}: ${p.question}\nA${i + 1}: ${p.answer}${cluster}`;
      })
      .join("\n\n");

    // ── Phase 3: Call Sarvam-105B for identity ──
    const nameInstruction = respondentName
      ? `\n\nThe respondent is named ${respondentName}. The summary should be in second person, addressing them by name once or twice — like '${respondentName}, here's what we heard...' Make it feel personally written for them. The label itself stays archetype-only; do not include the name in the label.`
      : "";

    const systemPrompt = `Given a respondent's answers across a form about how they live with AI, generate:
1. An identity label - 2-4 words, evocative, like 'Curious Skeptic' or 'Quiet Optimist' or 'Bold Pragmatist' or 'Cautious Adopter'. It should feel like a personality archetype that captures their stance.
2. A 1-2 sentence summary of their perspective in their own voice.
3. 3 standout 'highlights' - their most distinctive moments from the form.
${nameInstruction}

Output strict JSON only, no preamble or markdown: { "label": "...", "summary": "...", "highlights": ["...", "...", "..."] }`;

    let identity: IdentityResult;
    try {
      const llmRes = await chatComplete(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        {
          model: "sarvam-105b",
          temperature: 0.7,
          max_tokens: 400,
          top_p: 1,
          reasoning_effort: "low",
        }
      );

      const raw = llmRes.choices[0]?.message?.content?.trim() ?? "";
      identity = parseIdentity(raw) ?? fallbackIdentity();
    } catch (e) {
      console.error("[complete-session] LLM error:", e);
      identity = fallbackIdentity();
    }

    // ── Phase 4: Update sessions row with identity ──
    const { error: updateError } = await supabase
      .from("sessions")
      .update({
        identity_label: identity.label,
        identity_summary: identity.summary,
        completed_at: new Date().toISOString(),
      })
      .eq("id", session_id);

    if (updateError) {
      console.error("[complete-session] update session error:", updateError);
    }

    // ── Phase 5: Compute percentiles for emoji_slider questions ──
    const sliderAnswers = answers.filter(
      (a) =>
        a.questions?.input_type === "emoji_slider" &&
        a.raw_value &&
        typeof a.raw_value.value === "number"
    );

    const percentiles: PercentileEntry[] = [];

    if (sliderAnswers.length > 0) {
      const sliderQuestionIds = sliderAnswers.map((a) => a.questions!.id);
      const { data: aggData } = await supabase
        .from("aggregations")
        .select("question_id, distribution")
        .in("question_id", sliderQuestionIds);

      const aggMap = new Map<string, Pick<Aggregation, "distribution">>();
      for (const row of aggData ?? []) {
        aggMap.set(row.question_id, {
          distribution: (row.distribution ?? {}) as Record<string, number>,
        });
      }

      for (const a of sliderAnswers) {
        const q = a.questions!;
        const userValue = a.raw_value!.value as number;
        const agg = aggMap.get(q.id);
        const pct = agg
          ? computeSliderPercentile(userValue, agg.distribution)
          : 50;
        percentiles.push({
          question_id: q.id,
          question_prompt: q.prompt,
          user_value: userValue,
          percentile: pct,
        });
      }
    }

    return NextResponse.json({ identity, percentiles, respondent_name: respondentName });
  } catch (e) {
    console.error("[complete-session] error:", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
