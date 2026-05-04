import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { normalizeAnswer, type NormalizeResult } from "@/lib/llm";
import {
  generateReflectionCopy,
  pickReflectionWithDebug,
  type ReflectionType,
} from "@/lib/reflection";
import {
  cloneAggregation,
  computeAggregationUpdate,
  defaultAggregation,
  extractAnswerText,
} from "@/lib/aggregation";
import type { InputType, Aggregation, Cluster } from "@/lib/types";

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseReflectionHistory(value: unknown): ReflectionType[] {
  const valid = new Set<ReflectionType>([
    "comparison",
    "majority",
    "minority",
    "tribe",
    "emotion",
  ]);
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is ReflectionType =>
      typeof item === "string" && valid.has(item as ReflectionType)
    )
    .slice(-5);
}

// ── Route ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { session_id, question_id, raw_value, transcript, reflection_history } =
      (await req.json()) as {
        session_id?: string;
        question_id?: string;
        raw_value?: Record<string, unknown>;
        transcript?: string | null;
        reflection_history?: unknown;
      };

    if (!session_id || !question_id || raw_value === undefined) {
      return NextResponse.json(
        { error: "session_id, question_id, and raw_value are required." },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    // ── Phase 1: insert answer + fetch question + read aggregation (parallel) ─

    const [insertRes, questionRes, aggRes, sessionRes] = await Promise.all([
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
        .select("input_type, intent, prompt, options, position, form_id")
        .eq("id", question_id)
        .single(),
      supabase
        .from("aggregations")
        .select("*")
        .eq("question_id", question_id)
        .maybeSingle(),
      supabase
        .from("sessions")
        .select("respondent_name")
        .eq("id", session_id)
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
      prompt: string;
      options: unknown;
      position: number;
      form_id: string;
    };
    const inputType = question.input_type;

    // ── Name questions short-circuit: mirror to sessions.respondent_name and
    //    skip aggregation/normalize/reflection. Phase 1 spec: aggregations and
    //    reflections skip name questions.
    if (inputType === "name") {
      const nameValue =
        typeof raw_value.value === "string" ? raw_value.value.trim() : "";
      const writes: PromiseLike<unknown>[] = [
        supabase
          .from("questions")
          .select("id")
          .eq("form_id", question.form_id)
          .gt("position", question.position)
          .order("position", { ascending: true })
          .limit(1)
          .maybeSingle(),
      ];
      if (nameValue) {
        writes.push(
          supabase
            .from("sessions")
            .update({ respondent_name: nameValue })
            .eq("id", session_id)
        );
      }
      const [nextQRes] = (await Promise.all(writes)) as [
        { data: { id: string } | null },
        ...unknown[],
      ];
      return NextResponse.json({
        reflection: null,
        null_reason: null,
        debug_info: null,
        next_question_id: nextQRes?.data?.id ?? null,
      });
    }

    const isOpenEnded = inputType === "voice" || inputType === "text";
    const reflectionHistory = parseReflectionHistory(reflection_history);
    const respondentName =
      typeof sessionRes.data?.respondent_name === "string"
        ? sessionRes.data.respondent_name
        : null;

    // ── Phase 2: normalize (voice/text only, needs existing clusters) ─────────

    let normalizeResult: NormalizeResult | null = null;

    if (isOpenEnded) {
      const answerText = extractAnswerText(raw_value, transcript ?? null);
      if (answerText) {
        const existingClusters = (
          ((aggRes.data?.clusters ?? []) as Cluster[])
        ).map((c) => c.label);
        // 1.5s hard cap: under concurrent load Sarvam rate-limits, and waiting
        // 5s for clustering kills the user's perceived speed. Happy-path
        // normalize is ~500ms, so 1.5s leaves comfortable headroom; anything
        // slower means Sarvam is struggling and we'd rather ship a fast
        // reflection (without "tribe" clustering) than make the user wait.
        // The answer itself is already inserted above (Phase 1) — losing the
        // cluster label only costs downstream analytics granularity.
        try {
          normalizeResult = await normalizeAnswer(
            answerText,
            question.intent,
            existingClusters,
            { timeout_ms: 1500 }
          );
        } catch (e) {
          console.warn(
            "[answers] normalizeAnswer failed, continuing without cluster:",
            e instanceof Error ? e.message : e
          );
        }
      }
    }

    // ── Phase 3: compute updated aggregation ──────────────────────────────────
    // The reflection engine in Phase 5 below needs the PRE-mutation snapshot
    // so the current respondent doesn't see their own answer reflected back at
    // them. Sequencing stays here; the actual update math lives in
    // `lib/aggregation.ts`.

    const existingAgg: Aggregation | null = aggRes.data
      ? (aggRes.data as Aggregation)
      : null;
    const preMutationAgg = existingAgg
      ? cloneAggregation(existingAgg)
      : defaultAggregation(question_id);

    const agg = computeAggregationUpdate(existingAgg, question_id, {
      input_type: inputType,
      raw_value,
      transcript: transcript ?? null,
      normalized: normalizeResult
        ? {
            cluster: normalizeResult.cluster,
            is_new: normalizeResult.is_new,
            confidence: normalizeResult.confidence,
          }
        : null,
      sentiment: normalizeResult?.sentiment ?? null,
    });

    // ── Phase 4: persist aggregation + answer update + next question (parallel)

    const writeOps: PromiseLike<unknown>[] = [
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

    const picked = pickReflectionWithDebug(
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
      preMutationAgg,
      reflectionHistory,
      { sessionId: session_id, questionPosition: question.position }
    );

    const reflection = picked.reflection;
    if (reflection) {
      if (reflection.type === "tribe") {
        const clusterLabel = reflection.payload.clusterLabel;
        const matchedCluster = preMutationAgg.clusters.find(
          (c) => c.label === clusterLabel
        );
        const answerText = extractAnswerText(raw_value, transcript ?? null).toLowerCase();
        const quotePool = [
          ...(matchedCluster?.examples ?? []),
          ...preMutationAgg.recent_quotes,
        ];
        reflection.payload.quotes =
          quotePool
            .filter((q): q is string => typeof q === "string" && q.trim().length > 10)
            .map((q) => q.trim())
            .filter((q) => {
              const lower = q.toLowerCase();
              return !answerText || (!answerText.startsWith(lower) && !lower.startsWith(answerText.slice(0, 80)));
            })
            .filter((q, index, arr) => arr.findIndex((other) => other.toLowerCase() === q.toLowerCase()) === index)
            .slice(0, 3)
            .map((q) => (q.length > 100 ? `${q.slice(0, 100)}...` : q)) ?? [];
      }

      // Strip stale/renamed option keys from the distribution payload so the
      // chart only shows columns for options that currently exist on the question.
      // Happens when options were edited after answers were already collected.
      if (
        (reflection.type === "majority" || reflection.type === "minority") &&
        typeof reflection.payload.distribution === "object" &&
        reflection.payload.distribution !== null &&
        Array.isArray(question.options)
      ) {
        const validOptions = new Set(
          (question.options as unknown[]).filter(
            (o): o is string => typeof o === "string"
          )
        );
        if (validOptions.size > 0) {
          const dist = reflection.payload.distribution as Record<string, number>;
          reflection.payload.distribution = Object.fromEntries(
            Object.entries(dist).filter(([key]) => validOptions.has(key))
          );
        }
      }

      const generated = await generateReflectionCopy(
        reflection.type,
        reflection.payload,
        {
          questionPrompt: question.prompt,
          answerText: extractAnswerText(raw_value, transcript ?? null),
          respondentName,
        }
      );
      if (generated && generated.length > 0 && generated.length < 200) {
        reflection.copy = generated;
        reflection.source = "llm";
      } else {
        reflection.source = "fallback";
      }
    }

    // ── Phase 6: return ───────────────────────────────────────────────────────

    return NextResponse.json({
      reflection,
      null_reason: picked.null_reason ?? null,
      debug_info: picked.debug_info ?? null,
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
