import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import {
  buildClassificationAnswers,
  classifyIdentity,
  IdentityClassificationError,
} from "@/lib/identity";
import type { ArchetypeCluster, InputTypeSchema } from "@/lib/schemas";
import type { Aggregation } from "@/lib/types";

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
    input_type: InputTypeSchema;
    options: unknown;
    form_id: string;
  } | null;
}

interface SessionRow {
  respondent_name: string | null;
  form_id: string;
}

interface FormRow {
  intent: string | null;
  archetype_clusters: ArchetypeCluster[] | null;
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

    // ── 1. Session row (need form_id + name) ─────────────────────────────────
    const { data: sessionRow } = await supabase
      .from("sessions")
      .select("respondent_name, form_id")
      .eq("id", session_id)
      .maybeSingle();

    const session = sessionRow as SessionRow | null;
    if (!session?.form_id) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 }
      );
    }
    const respondentName =
      typeof session.respondent_name === "string"
        ? session.respondent_name
        : null;

    // ── 2. Form row (need intent + archetype_clusters) ──────────────────────
    const { data: formRow, error: formError } = await supabase
      .from("forms")
      .select("intent, archetype_clusters")
      .eq("id", session.form_id)
      .maybeSingle();

    if (formError || !formRow) {
      console.error("[complete-session] fetch form error:", formError);
      return NextResponse.json(
        { error: "Form not found" },
        { status: 404 }
      );
    }
    const form = formRow as FormRow;
    const archetypeClusters = (form.archetype_clusters ?? []) as ArchetypeCluster[];
    if (archetypeClusters.length === 0) {
      console.error("[complete-session] form has no archetype clusters");
      return NextResponse.json(
        { error: "form_misconfigured", message: "Form has no archetypes." },
        { status: 500 }
      );
    }

    // ── 3. Answers + joined questions ────────────────────────────────────────
    const { data: answersData, error: answersError } = await supabase
      .from("answers")
      .select(
        `
        raw_value,
        transcript,
        normalized,
        questions ( id, prompt, input_type, options, form_id )
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

    // ── 4. Classify identity ─────────────────────────────────────────────────
    const classificationAnswers = buildClassificationAnswers(answers);

    let identity;
    try {
      identity = await classifyIdentity({
        formIntent: form.intent ?? "",
        archetypeClusters,
        answers: classificationAnswers,
        respondentName,
      });
    } catch (err) {
      if (err instanceof IdentityClassificationError) {
        console.error(
          `[complete-session] classifyIdentity (${err.kind}) failed:`,
          err.message
        );
      } else {
        console.error("[complete-session] classifyIdentity unexpected:", err);
      }
      // Phase 5 architectural decision: NO generic fallback. Surface the error
      // so the client can show a real error state and the user can retry. The
      // alternative ("Quiet Observer") was misleading users.
      return NextResponse.json(
        {
          error: "identity_classification_failed",
          message:
            "We couldn't generate your identity right now. Please try again in a moment.",
        },
        { status: 502 }
      );
    }

    // ── 5. Update sessions row ───────────────────────────────────────────────
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

    // ── 6. Compute percentiles for emoji_slider questions ────────────────────
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

    return NextResponse.json({
      identity,
      percentiles,
      respondent_name: respondentName,
    });
  } catch (e) {
    console.error("[complete-session] error:", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
