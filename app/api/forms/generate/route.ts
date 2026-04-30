import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import {
  formGenerationInputSchema,
  generateForm,
  FormGenerationError,
} from "@/lib/form-generation";
import {
  generatePersonas,
  PersonaGenerationError,
} from "@/lib/persona-generation";
import {
  generateSeedResponses,
  seedAnswerToRawValue,
  SeedGenerationError,
} from "@/lib/seed-generation";
import {
  seedAggregations,
  type SeedAnswerWithMeta,
  type SeedAggregationQuestion,
} from "@/lib/aggregation";
import {
  buildClassificationAnswers,
  classifyIdentity,
  IdentityClassificationError,
  type ClassificationAnswer,
} from "@/lib/identity";
import type {
  Question as SchemaQuestion,
  ArchetypeCluster,
  Persona,
  SeedResponse,
} from "@/lib/schemas";
import type { InputType } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 240;

// =============================================================================
// Seed persistence
// =============================================================================

/**
 * Insert seed sessions + answers for the form. One session per successful
 * SeedResponse, with all rows tagged `is_seed = true`. Session timestamps are
 * staggered across the past 24 hours so the live ENTRY screen counter shows
 * a believable distribution. Per-persona "transaction" semantics: insert
 * session, then batch-insert answers; if the answer batch fails, delete the
 * session to avoid orphans. Failures of individual personas don't abort the
 * loop — we want to land as many seeds as we can.
 */
interface PersistedSeedSession {
  session_id: string;
  persona_name: string;
  /** The persona's full SeedResponse — needed for identity classification later. */
  response: SeedResponse;
}

async function persistSeed(
  supabase: ReturnType<typeof createAdminClient>,
  formId: string,
  questionsByPosition: Map<number, { id: string; input_type: InputType }>,
  generatedQuestions: SchemaQuestion[],
  seedResponses: SeedResponse[],
  anonymous: boolean
): Promise<{
  sessionsInserted: number;
  answersInserted: number;
  seedAnswers: SeedAnswerWithMeta[];
  seedSessions: PersistedSeedSession[];
}> {
  let sessionsInserted = 0;
  let answersInserted = 0;
  const seedAnswers: SeedAnswerWithMeta[] = [];
  const seedSessions: PersistedSeedSession[] = [];

  const now = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;

  for (const persona of seedResponses) {
    const startedAtMs = now - Math.random() * oneDayMs;
    const startedAt = new Date(startedAtMs).toISOString();
    // Sessions complete 2–5 minutes after starting.
    const completedAtMs = startedAtMs + (120 + Math.random() * 180) * 1000;
    const completedAt = new Date(completedAtMs).toISOString();

    const respondentName = anonymous ? null : persona.persona_name;

    const { data: session, error: sessionError } = await supabase
      .from("sessions")
      .insert({
        form_id: formId,
        respondent_name: respondentName,
        started_at: startedAt,
        completed_at: completedAt,
        identity_label: null,
        identity_summary: null,
        is_seed: true,
      })
      .select("id")
      .single();

    if (sessionError || !session) {
      console.error(
        `[phase-3:persist] session insert failed for persona ${persona.persona_name}:`,
        sessionError
      );
      continue;
    }

    const sessionId = session.id as string;

    const answerRows = persona.answers
      .map((answer, i) => {
        const generatedQ = generatedQuestions[i];
        if (!generatedQ) return null;
        const dbQ = questionsByPosition.get(generatedQ.position);
        if (!dbQ) return null;
        if (dbQ.input_type !== answer.input_type) {
          console.error(
            `[phase-3:persist] persona ${persona.persona_name} Q${i + 1}: answer input_type ${answer.input_type} mismatches DB ${dbQ.input_type}; skipping`
          );
          return null;
        }
        const { rawValue, transcript } = seedAnswerToRawValue(answer);
        // Stagger answers ~25s apart within the session window with jitter.
        const createdAtMs =
          startedAtMs + (i + 1) * 25_000 + Math.random() * 10_000;
        return {
          session_id: sessionId,
          question_id: dbQ.id,
          raw_value: rawValue,
          transcript,
          normalized: null,
          sentiment: 0,
          created_at: new Date(createdAtMs).toISOString(),
          is_seed: true,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    if (answerRows.length === 0) {
      // No answers landed — this session is useless. Roll it back.
      await supabase.from("sessions").delete().eq("id", sessionId);
      continue;
    }

    const { error: answerError } = await supabase
      .from("answers")
      .insert(answerRows);

    if (answerError) {
      console.error(
        `[phase-3:persist] answers insert failed for persona ${persona.persona_name}:`,
        answerError
      );
      await supabase.from("sessions").delete().eq("id", sessionId);
      continue;
    }

    sessionsInserted += 1;
    answersInserted += answerRows.length;
    for (const row of answerRows) {
      seedAnswers.push({
        session_id: row.session_id,
        question_id: row.question_id,
        raw_value: row.raw_value as Record<string, unknown>,
        transcript: row.transcript,
        input_type: (row.raw_value as { type: InputType }).type,
      });
    }
    seedSessions.push({
      session_id: sessionId,
      persona_name: persona.persona_name,
      response: persona,
    });
  }

  return { sessionsInserted, answersInserted, seedAnswers, seedSessions };
}

// =============================================================================
// Route
// =============================================================================

export async function POST(req: NextRequest) {
  console.time("api:forms:generate:total");
  try {
    const rawBody = await req.json().catch(() => null);
    if (rawBody === null) {
      return NextResponse.json(
        { error: "Invalid JSON body." },
        { status: 400 }
      );
    }

    const parsedInput = formGenerationInputSchema.safeParse(rawBody);
    if (!parsedInput.success) {
      return NextResponse.json(
        {
          error: "Invalid request body.",
          issues: parsedInput.error.issues,
        },
        { status: 400 }
      );
    }
    const input = parsedInput.data;

    // ── Stage A: form generation ──────────────────────────────────────────────

    let generated;
    try {
      generated = await generateForm(input);
    } catch (err) {
      if (err instanceof FormGenerationError) {
        console.error(`[api:forms:generate] ${err.kind} error:`, err.message);
        if (err.kind === "validation" || err.kind === "parse") {
          return NextResponse.json(
            {
              error: "Form generation failed schema validation after retries.",
              issues: err.issues,
            },
            { status: 502 }
          );
        }
        return NextResponse.json(
          { error: `Sarvam error: ${err.message}` },
          { status: 502 }
        );
      }
      console.error("[api:forms:generate] unexpected error:", err);
      return NextResponse.json(
        { error: "Form generation failed." },
        { status: 502 }
      );
    }

    const supabase = createAdminClient();

    // ── Persist form + questions ──────────────────────────────────────────────

    const { data: form, error: formError } = await supabase
      .from("forms")
      .insert({
        title: input.formTitle,
        intent: input.formIntent,
        tone: input.tone,
        anonymous: input.anonymous,
        archetype_clusters: generated.archetype_clusters,
        status: "published",
      })
      .select("id")
      .single();

    if (formError || !form) {
      console.error("[api:forms:generate] forms insert error:", formError);
      return NextResponse.json(
        { error: formError?.message ?? "Failed to insert form." },
        { status: 500 }
      );
    }

    const userIntentByPosition = new Map<number, string>();
    input.questionIntents.forEach((q, i) => {
      const position = input.anonymous ? i : i + 1;
      userIntentByPosition.set(position, q.intent);
    });

    const questionRows = generated.questions.map((q) => ({
      form_id: form.id,
      position: q.position,
      prompt: q.prompt,
      intent:
        q.input_type === "name"
          ? "system: name capture"
          : userIntentByPosition.get(q.position) ?? null,
      input_type: q.input_type,
      options: q.options,
      follow_up_enabled:
        q.input_type === "voice" ||
        q.input_type === "text" ||
        q.input_type === "name",
      required: true,
    }));

    const { data: insertedQuestions, error: qError } = await supabase
      .from("questions")
      .insert(questionRows)
      .select("id, position, input_type, intent");

    if (qError || !insertedQuestions) {
      console.error("[api:forms:generate] questions insert error:", qError);
      const { error: deleteError } = await supabase
        .from("forms")
        .delete()
        .eq("id", form.id);
      if (deleteError) {
        console.error(
          "[api:forms:generate] cleanup delete failed:",
          deleteError
        );
      }
      return NextResponse.json(
        {
          error: `Failed to insert questions; rolled back form. ${qError?.message ?? ""}`,
        },
        { status: 500 }
      );
    }

    const questionsByPosition = new Map<
      number,
      { id: string; input_type: InputType }
    >();
    const aggregationQuestions: SeedAggregationQuestion[] = [];
    for (const row of insertedQuestions as Array<{
      id: string;
      position: number;
      input_type: InputType;
      intent: string | null;
    }>) {
      questionsByPosition.set(row.position, {
        id: row.id,
        input_type: row.input_type,
      });
      aggregationQuestions.push({
        id: row.id,
        input_type: row.input_type,
        intent: row.intent,
      });
    }

    // ── Stage B: persona generation ───────────────────────────────────────────
    // From here on, failures don't roll back the form — it's a usable form
    // even without seeds. We just return the form ID with reduced seed counts.

    let personas: Persona[] = [];
    let stageBFailed = false;

    try {
      personas = await generatePersonas({
        formTitle: input.formTitle,
        formIntent: input.formIntent,
        questions: generated.questions,
        archetypeClusters: generated.archetype_clusters as ArchetypeCluster[],
      });
    } catch (err) {
      stageBFailed = true;
      if (err instanceof PersonaGenerationError) {
        console.error(
          `[api:forms:generate] Stage B (${err.kind}) failed:`,
          err.message
        );
      } else {
        console.error("[api:forms:generate] Stage B unexpected error:", err);
      }
    }

    // ── Stage C: seed responses (parallel, per-persona) ───────────────────────

    let seedResponses: SeedResponse[] = [];
    let stageCFailed = false;

    if (!stageBFailed && personas.length > 0) {
      try {
        seedResponses = await generateSeedResponses({
          formIntent: input.formIntent,
          questions: generated.questions,
          personas,
          archetypeClusters: generated.archetype_clusters as ArchetypeCluster[],
        });
      } catch (err) {
        stageCFailed = true;
        if (err instanceof SeedGenerationError) {
          console.error("[api:forms:generate] Stage C failed:", err.message);
          // Salvage any partial successes — even 1–6 personas is better than 0
          // for a form that creators will inspect during demo.
          if (err.partialResults && err.partialResults.length > 0) {
            seedResponses = err.partialResults;
          }
        } else {
          console.error("[api:forms:generate] Stage C unexpected error:", err);
        }
      }
    }

    // ── Persistence: sessions + answers ───────────────────────────────────────

    let persistResult: {
      sessionsInserted: number;
      answersInserted: number;
      seedAnswers: SeedAnswerWithMeta[];
      seedSessions: PersistedSeedSession[];
    } = {
      sessionsInserted: 0,
      answersInserted: 0,
      seedAnswers: [],
      seedSessions: [],
    };
    if (seedResponses.length > 0) {
      console.time("phase-3:persistence");
      try {
        persistResult = await persistSeed(
          supabase,
          form.id,
          questionsByPosition,
          generated.questions,
          seedResponses,
          input.anonymous
        );
      } catch (err) {
        console.error("[api:forms:generate] persistence error:", err);
      } finally {
        console.timeEnd("phase-3:persistence");
      }
    }

    // ── Stage D: aggregation seed ─────────────────────────────────────────────
    // Bulk-fold the seed answers into per-question aggregation rows so the
    // first real respondent sees populated distributions/quotes/clusters from
    // session 1. Backfills sentiment + clusters via `normalizeAnswer()` for
    // voice/text questions. Failures here don't block the form — the form is
    // usable without seeded aggregations (just less rich for early respondents).

    let aggregationsSeeded = 0;
    let normalizeCalls = 0;
    if (persistResult.seedAnswers.length > 0) {
      try {
        const result = await seedAggregations(
          form.id,
          aggregationQuestions,
          persistResult.seedAnswers,
          { backfillSentiment: true }
        );
        aggregationsSeeded = result.aggregations_created;
        normalizeCalls = result.normalize_calls;
      } catch (err) {
        console.error("[api:forms:generate] seedAggregations error:", err);
      }
    }

    // ── Stage E: seed identity classification ────────────────────────────────
    // Classify each of the 10 seed sessions into one of the form's archetypes
    // so tribe reflections have something to draw from before any real users
    // complete. Parallel across sessions (Promise.allSettled); failures drop
    // that session's identity to null but don't fail the form-creation.

    let seedIdentitiesClassified = 0;
    if (persistResult.seedSessions.length > 0) {
      console.time("phase-5:seed-identities:wall");
      const archetypeClusters =
        generated.archetype_clusters as ArchetypeCluster[];

      const settled = await Promise.allSettled(
        persistResult.seedSessions.map(async (s, i) => {
          const t0 = Date.now();
          // Convert the persona's in-memory SeedAnswer[] into the raw-DB-row
          // shape `buildClassificationAnswers` consumes. Same path real users
          // take, just sourced from memory instead of Supabase.
          const rawRows = s.response.answers
            .map((answer, idx) => {
              const generatedQ = generated.questions[idx];
              if (!generatedQ) return null;
              const { rawValue, transcript } = seedAnswerToRawValue(answer);
              return {
                raw_value: rawValue,
                transcript,
                normalized: null,
                questions: {
                  prompt: generatedQ.prompt,
                  input_type: generatedQ.input_type,
                  options: generatedQ.options,
                },
              };
            })
            .filter((r): r is NonNullable<typeof r> => r !== null);

          const classificationAnswers: ClassificationAnswer[] =
            buildClassificationAnswers(rawRows);

          const respondentName = input.anonymous ? null : s.persona_name;
          const identity = await classifyIdentity({
            formIntent: input.formIntent,
            archetypeClusters,
            answers: classificationAnswers,
            respondentName,
          });

          const { error: updateError } = await supabase
            .from("sessions")
            .update({
              identity_label: identity.label,
              identity_summary: identity.summary,
            })
            .eq("id", s.session_id);
          if (updateError) {
            throw new Error(
              `update sessions.identity failed: ${updateError.message}`
            );
          }
          console.log(
            `[phase-5:seed-identity:${i}] ${s.persona_name} → "${identity.label}" (${Date.now() - t0}ms)`
          );
          return identity;
        })
      );

      for (const r of settled) {
        if (r.status === "fulfilled") {
          seedIdentitiesClassified += 1;
        } else {
          const err = r.reason;
          if (err instanceof IdentityClassificationError) {
            console.error(
              `[phase-5:seed-identity] (${err.kind}) ${err.message}`
            );
          } else {
            console.error(
              `[phase-5:seed-identity] unexpected error:`,
              err instanceof Error ? err.message : err
            );
          }
        }
      }
      console.log(
        `[phase-5:seed-identities] classified ${seedIdentitiesClassified}/${persistResult.seedSessions.length}`
      );
      console.timeEnd("phase-5:seed-identities:wall");
    }

    // ── Response ──────────────────────────────────────────────────────────────

    const seedStatus =
      persistResult.sessionsInserted === 10
        ? "full"
        : persistResult.sessionsInserted >= 7
          ? "partial"
          : persistResult.sessionsInserted > 0
            ? "thin"
            : "none";

    return NextResponse.json(
      {
        id: form.id,
        questions_created: questionRows.length,
        archetypes_count: generated.archetype_clusters.length,
        personas_count: personas.length,
        seed_responses_count: persistResult.sessionsInserted,
        seed_answers_count: persistResult.answersInserted,
        aggregations_seeded: aggregationsSeeded,
        normalize_calls: normalizeCalls,
        seed_identities_classified: seedIdentitiesClassified,
        seed_status: seedStatus,
        ...(stageBFailed ? { stage_b_failed: true } : {}),
        ...(stageCFailed ? { stage_c_failed: true } : {}),
      },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation error.", issues: err.issues },
        { status: 400 }
      );
    }
    console.error("[api:forms:generate] internal error:", err);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 }
    );
  } finally {
    console.timeEnd("api:forms:generate:total");
  }
}
