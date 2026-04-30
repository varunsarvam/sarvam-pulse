import { z } from "zod";

/**
 * Phase 1 schemas for the Pulse intelligence-layer rebuild.
 *
 * These define the contracts produced by the upcoming server-side LLM
 * pipelines (Stages A–C and identity classification). No runtime code
 * beyond these schemas is implemented in this phase.
 *
 * See `docs/schemas.md` for prose documentation and JSON examples.
 */

// =============================================================================
// Constants
// =============================================================================

/**
 * Hardcoded phrasing for the auto-inserted Q1 name question.
 *
 * The name question is identical across all forms, so Stage A does not
 * spend an LLM call generating phrasing for it. The respondent never
 * sees this in the question flow — the value is captured on the SETUP
 * screen and silently written as the Q1 answer.
 */
export const NAME_QUESTION_PROMPT = "What should I call you?";

// =============================================================================
// Length limits
// =============================================================================

/**
 * Length caps applied across the schemas. Centralised so the LLM prompts
 * (which mirror these in `lib/form-generation.ts`) stay in lockstep with
 * the Zod-enforced rules. Tuned to UI visual limits — see
 * `docs/schemas.md` "Length constraints" for rationale.
 */
export const LENGTH_LIMITS = {
  questionPrompt: 130,
  cardsOption: 32,
  thisOrThatOption: 40,
  rankingOption: 44,
  visualSelectLabel: 28,
  emojiSliderLabel: 20,
  archetypeLabel: 32,
  archetypeDescription: 200,
  archetypeSignal: 80,
  personaName: 24,
  personaStance: 200,
  personaVoiceQuirks: 200,
  identityLabel: 32,
  identitySummary: 200,
  identityHighlight: 60,
  seedTranscript: 400,
  seedNameValue: 24,
} as const;

// =============================================================================
// Input types
// =============================================================================

/**
 * The full set of input types Pulse supports. `name` is a first-class
 * input type — it is auto-inserted as Q1 by the form generation pipeline
 * (unless `forms.anonymous = true`).
 */
export const inputTypeSchema = z.enum([
  "name",
  "voice",
  "text",
  "emoji_slider",
  "cards",
  "ranking",
  "this_or_that",
  "visual_select",
]);
export type InputTypeSchema = z.infer<typeof inputTypeSchema>;

// =============================================================================
// ArchetypeCluster
// =============================================================================

/**
 * A named "kind of respondent" for a given form.
 *
 * Produced: as part of Stage A form generation; persisted on the form.
 * Consumed: by Stage 5 identity classification to match a respondent's
 * answer pattern to one of the form's archetypes.
 *
 * Globally unique label within a form (enforced at insertion time, not
 * in this schema, since uniqueness is a list-level invariant).
 */
export const archetypeClusterSchema = z.object({
  label: z.string().min(1).max(LENGTH_LIMITS.archetypeLabel),
  description: z.string().min(1).max(LENGTH_LIMITS.archetypeDescription),
  indicator_signals: z
    .array(z.string().min(1).max(LENGTH_LIMITS.archetypeSignal))
    .min(1),
});
export type ArchetypeCluster = z.infer<typeof archetypeClusterSchema>;

// =============================================================================
// Question (output of Stage A)
// =============================================================================

/**
 * A fully-realized question that gets stored in the `questions` table.
 *
 * Produced: by Stage A form generation.
 * Consumed: by the respondent flow (`/respond/[formId]`) and by Stage C
 * seed response generation.
 *
 * Discriminated on `input_type` so each variant pins down its `options`
 * shape exactly.
 */
const baseQuestionFields = {
  prompt: z.string().min(1).max(LENGTH_LIMITS.questionPrompt),
  position: z.int().nonnegative(),
};

export const questionSchema = z.discriminatedUnion("input_type", [
  z.object({
    ...baseQuestionFields,
    input_type: z.literal("name"),
    options: z.null(),
  }),
  z.object({
    ...baseQuestionFields,
    input_type: z.literal("voice"),
    options: z.null(),
  }),
  z.object({
    ...baseQuestionFields,
    input_type: z.literal("text"),
    options: z.null(),
  }),
  z.object({
    ...baseQuestionFields,
    input_type: z.literal("emoji_slider"),
    options: z.object({
      min_label: z.string().min(1).max(LENGTH_LIMITS.emojiSliderLabel),
      max_label: z.string().min(1).max(LENGTH_LIMITS.emojiSliderLabel),
    }),
  }),
  z.object({
    ...baseQuestionFields,
    input_type: z.literal("cards"),
    options: z
      .array(z.string().min(1).max(LENGTH_LIMITS.cardsOption))
      .min(2)
      .max(8),
  }),
  z.object({
    ...baseQuestionFields,
    input_type: z.literal("ranking"),
    options: z
      .array(z.string().min(1).max(LENGTH_LIMITS.rankingOption))
      .min(2)
      .max(8),
  }),
  z.object({
    ...baseQuestionFields,
    input_type: z.literal("this_or_that"),
    options: z
      .array(z.string().min(1).max(LENGTH_LIMITS.thisOrThatOption))
      .length(2),
  }),
  z.object({
    ...baseQuestionFields,
    input_type: z.literal("visual_select"),
    options: z
      .array(
        z.object({
          label: z.string().min(1).max(LENGTH_LIMITS.visualSelectLabel),
          image_url: z.string().url(),
        })
      )
      .min(2)
      .max(6),
  }),
]);
export type Question = z.infer<typeof questionSchema>;

// =============================================================================
// FormGenerationOutput (output of Stage A)
// =============================================================================

/**
 * The full output of Stage A — the LLM's structured response and the
 * exact shape persisted to the `forms` + `questions` tables.
 *
 * Use the `formGenerationOutputSchemaFor({ anonymous })` factory to get
 * a schema appropriate for the form's mode. The two modes share the
 * same TypeScript shape; only the Q1-is-name rule differs.
 *
 * Validation rules:
 *  - (non-anonymous only) questions[0] must have input_type === "name"
 *    and position === 0
 *  - all questions must have positions 0..n-1, contiguous, no gaps
 *  - archetype cluster labels must be unique within the form
 *
 * Both modes still require `archetype_clusters` length 3–5 and at least
 * one question.
 */
const formGenerationOutputBaseSchema = z.object({
  questions: z.array(questionSchema).min(1),
  archetype_clusters: z.array(archetypeClusterSchema).min(3).max(5),
});

export function formGenerationOutputSchemaFor({
  anonymous,
}: {
  anonymous: boolean;
}) {
  return formGenerationOutputBaseSchema.superRefine((value, ctx) => {
    const { questions, archetype_clusters } = value;

    if (!anonymous) {
      const first = questions[0];
      if (first.input_type !== "name" || first.position !== 0) {
        ctx.addIssue({
          code: "custom",
          message:
            "questions[0] must be the name question (input_type='name', position=0)",
          path: ["questions", 0],
        });
      }
    }

    for (let i = 0; i < questions.length; i++) {
      if (questions[i].position !== i) {
        ctx.addIssue({
          code: "custom",
          message: `questions[${i}].position must be ${i} (positions must be contiguous, starting at 0)`,
          path: ["questions", i, "position"],
        });
      }
    }

    const labels = new Set<string>();
    for (let i = 0; i < archetype_clusters.length; i++) {
      const label = archetype_clusters[i].label;
      if (labels.has(label)) {
        ctx.addIssue({
          code: "custom",
          message: `archetype label "${label}" is duplicated; labels must be unique within a form`,
          path: ["archetype_clusters", i, "label"],
        });
      }
      labels.add(label);
    }
  });
}

/** Convenience alias for the non-anonymous schema, used to derive the type. */
export const formGenerationOutputSchema = formGenerationOutputSchemaFor({
  anonymous: false,
});
export type FormGenerationOutput = z.infer<typeof formGenerationOutputSchema>;

// =============================================================================
// Persona (output of Stage B)
// =============================================================================

/**
 * A synthetic respondent used for Stage C seed-data generation.
 *
 * Produced: by Stage B persona generation (10 personas per form).
 * Consumed: by Stage C, which generates one full `SeedResponse` per persona.
 *
 * `archetype_label` must match one of the form's `ArchetypeCluster.label`
 * values — this is a runtime cross-validation, not enforced in Zod alone
 * (see `Identity` for the same pattern).
 */
export const personaSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(LENGTH_LIMITS.personaName)
    .refine((n) => !/\s/.test(n), {
      message:
        "Persona name must be a single word with no whitespace (first name only)",
    }),
  age_range: z.string().min(1),
  occupation: z.string().min(1),
  stance: z.string().min(1).max(LENGTH_LIMITS.personaStance),
  voice_quirks: z.string().min(1).max(LENGTH_LIMITS.personaVoiceQuirks),
  archetype_label: z.string().min(1).max(LENGTH_LIMITS.archetypeLabel),
});
export type Persona = z.infer<typeof personaSchema>;

// =============================================================================
// SeedResponse (output of Stage C)
// =============================================================================

/**
 * A complete answer set for one persona across every question in a form.
 *
 * Produced: by Stage C, once per persona (10 per form).
 * Consumed: insertion job that writes `sessions` + `answers` rows with
 * `is_seed = true` (added in a later phase).
 *
 * The answer shape is a discriminated union on `input_type` that mirrors
 * `Question` exactly. Cross-validation that, e.g., `cards.selected` is
 * actually one of the question's options is performed at insertion time
 * (not in Zod) since it requires the corresponding `Question` in scope.
 */
export const seedAnswerSchema = z.discriminatedUnion("input_type", [
  z.object({
    input_type: z.literal("name"),
    value: z.string().min(1).max(LENGTH_LIMITS.seedNameValue),
  }),
  z.object({
    input_type: z.literal("voice"),
    transcript: z.string().min(1).max(LENGTH_LIMITS.seedTranscript),
  }),
  z.object({
    input_type: z.literal("text"),
    transcript: z.string().min(1).max(LENGTH_LIMITS.seedTranscript),
  }),
  z.object({
    input_type: z.literal("emoji_slider"),
    value: z.number().min(0).max(100),
  }),
  z.object({
    input_type: z.literal("cards"),
    selected: z.string().min(1),
  }),
  z.object({
    input_type: z.literal("ranking"),
    ordered: z.array(z.string().min(1)).min(2),
  }),
  z.object({
    input_type: z.literal("this_or_that"),
    selected: z.string().min(1),
  }),
  z.object({
    input_type: z.literal("visual_select"),
    selected: z.string().min(1),
  }),
]);
export type SeedAnswer = z.infer<typeof seedAnswerSchema>;

export const seedResponseSchema = z.object({
  persona_name: z.string().min(1).max(LENGTH_LIMITS.personaName),
  answers: z.array(seedAnswerSchema).min(1),
});
export type SeedResponse = z.infer<typeof seedResponseSchema>;

// =============================================================================
// Identity (output of Phase 5 identity classification)
// =============================================================================

/**
 * The form-specific identity assigned to a respondent at the end of
 * their session.
 *
 * Produced: by `/api/complete-session` (Phase 5 LLM call).
 * Consumed: `CompleteStage`, the share page, and the `sessions` row.
 *
 * `label` must match one of the form's `ArchetypeCluster.label` values.
 * Since the valid label set is per-form runtime data, the constraint is
 * expressed via `identitySchemaFor(labels)` rather than baked into a
 * static schema. The base `identitySchema` validates only the shape;
 * call sites should use the configured variant.
 *
 * No generic fallback. If the LLM call fails, the surface should show
 * an error state — never substitute a default label.
 */
export const identitySchema = z.object({
  label: z.string().min(1).max(LENGTH_LIMITS.identityLabel),
  summary: z.string().min(1).max(LENGTH_LIMITS.identitySummary),
  highlights: z
    .array(z.string().min(1).max(LENGTH_LIMITS.identityHighlight))
    .length(3),
});
export type Identity = z.infer<typeof identitySchema>;

/**
 * Returns an `Identity` schema configured for a specific form's archetype
 * label set. Use this at the Phase 5 call site once the form's archetypes
 * have been fetched.
 */
export function identitySchemaFor(allowedLabels: readonly string[]) {
  const allowed = new Set(allowedLabels);
  return identitySchema.refine((value) => allowed.has(value.label), {
    message: `label must be one of: ${allowedLabels.join(", ")}`,
    path: ["label"],
  });
}
