import { z } from "zod";
import { chatComplete } from "./sarvam";
import {
  identitySchemaFor,
  type Identity,
  type ArchetypeCluster,
  type Question,
  type InputTypeSchema,
} from "./schemas";

/**
 * Phase 5 — Identity classification.
 *
 * Pure-logic library (no DB access). Mirrors `lib/aggregation.ts` shape:
 * the live answers route at `/api/complete-session` and the seeding pipeline
 * in `/api/forms/generate` both call `classifyIdentity()` to assign a
 * respondent (real or seeded) to one of the form's archetype clusters.
 *
 * The output is validated with `identitySchemaFor(allowedLabels)` so the
 * label is GUARANTEED to be one of the form's archetype labels — no
 * paraphrasing, no invented categories. There is intentionally NO generic
 * fallback (e.g. "Quiet Observer"); failures throw and the caller decides
 * how to surface that to the user.
 */

// =============================================================================
// Errors
// =============================================================================

export class IdentityClassificationError extends Error {
  readonly kind: "validation" | "sarvam" | "parse";
  readonly issues?: z.ZodIssue[];
  readonly attempts?: string[];
  constructor(
    kind: "validation" | "sarvam" | "parse",
    message: string,
    extras: { issues?: z.ZodIssue[]; attempts?: string[] } = {}
  ) {
    super(message);
    this.kind = kind;
    this.issues = extras.issues;
    this.attempts = extras.attempts;
    this.name = "IdentityClassificationError";
  }
}

// =============================================================================
// Configuration
// =============================================================================

// Aggressive timeouts: sarvam-105b normally returns in ~2-4s; 8s leaves
// comfortable headroom under mild load and bails out fast under heavy load
// rather than holding the user on the LoadingShimmer for a full minute.
// Two attempts × 8s = 16s worst case (was 3 × 60s = 180s).
const SARVAM_TIMEOUT_MS = 8_000;
const SARVAM_MODEL = "sarvam-105b";
const MAX_ATTEMPTS = 2;

// =============================================================================
// Public types
// =============================================================================

export interface ClassificationAnswer {
  question_prompt: string;
  question_input_type: InputTypeSchema;
  /**
   * Free-text rendering of the answer suitable for the LLM:
   * - voice/text: the transcript
   * - cards/this_or_that/visual_select: the selected option
   * - emoji_slider: the numeric value as a string (caller may include
   *   scale labels via `slider_scale` for richer context)
   * - ranking: "1. A | 2. B | 3. C | 4. D"
   */
  answer_text: string;
  /** Human-friendly slider scale, e.g. "0=Never → 100=Constantly". */
  slider_scale?: string;
  /** Cluster label from `normalizeAnswer()` if available (voice/text only). */
  cluster_label?: string;
}

// =============================================================================
// Helper: build ClassificationAnswer[] from raw inputs
// =============================================================================

interface RawAnswerRow {
  raw_value: { type?: string; value?: unknown } | null;
  transcript: string | null;
  normalized: { cluster?: string } | null;
  questions: {
    prompt: string;
    input_type: InputTypeSchema;
    options?: unknown;
  } | null;
}

function rawValueToText(
  inputType: InputTypeSchema,
  rawValue: { value?: unknown } | null,
  transcript: string | null
): string {
  if (transcript && transcript.trim()) return transcript.trim();
  const v = rawValue?.value;
  if (inputType === "ranking" && Array.isArray(v)) {
    return v.map((item, i) => `${i + 1}. ${item}`).join(" | ");
  }
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return v.map((x) => String(x)).join(", ");
  return v == null ? "" : JSON.stringify(v);
}

function sliderScaleFor(question: {
  input_type: InputTypeSchema;
  options?: unknown;
}): string | undefined {
  if (question.input_type !== "emoji_slider") return undefined;
  const opts = question.options as
    | { min_label?: string; max_label?: string }
    | null
    | undefined;
  if (opts && opts.min_label && opts.max_label) {
    return `0=${opts.min_label} → 100=${opts.max_label}`;
  }
  return undefined;
}

/**
 * Convert raw DB rows (with their joined question record) into the
 * ClassificationAnswer shape the prompt builder consumes. Skips name questions
 * (they leak the name into context and don't carry archetype signal) and
 * answers that resolve to empty strings.
 */
export function buildClassificationAnswers(
  rows: RawAnswerRow[]
): ClassificationAnswer[] {
  const out: ClassificationAnswer[] = [];
  for (const row of rows) {
    const q = row.questions;
    if (!q) continue;
    if (q.input_type === "name") continue;
    const text = rawValueToText(q.input_type, row.raw_value, row.transcript);
    if (!text) continue;
    out.push({
      question_prompt: q.prompt,
      question_input_type: q.input_type,
      answer_text: text,
      slider_scale: sliderScaleFor(q),
      cluster_label: row.normalized?.cluster?.trim() || undefined,
    });
  }
  return out;
}

// =============================================================================
// Prompt construction
// =============================================================================

function buildSystemPrompt(input: {
  formIntent: string;
  archetypeClusters: ArchetypeCluster[];
  respondentName: string | null;
  answers: ClassificationAnswer[];
}): string {
  const { formIntent, archetypeClusters, respondentName, answers } = input;

  const archetypeLines = archetypeClusters
    .map((a) => {
      const signals = a.indicator_signals.slice(0, 3).join("; ");
      return `- "${a.label}" — ${a.description}\n  Signals: ${signals}`;
    })
    .join("\n");

  const archetypeLabelList = archetypeClusters
    .map((a) => `"${a.label}"`)
    .join(", ");

  const answerLines = answers
    .map((a, i) => {
      const typeNote =
        a.question_input_type === "emoji_slider" && a.slider_scale
          ? ` (scale: ${a.slider_scale})`
          : "";
      const clusterNote = a.cluster_label
        ? ` [theme: ${a.cluster_label}]`
        : "";
      return `Q${i + 1} [${a.question_input_type}${typeNote}]: ${a.question_prompt}\nA${i + 1}: ${a.answer_text}${clusterNote}`;
    })
    .join("\n\n");

  const subject = respondentName ?? "this respondent";
  const nameInstruction = respondentName
    ? `The respondent's name is ${respondentName}. The summary should address them by name once — like "${respondentName}, ..." — and read like THEIR own self-description, not a third-person profile. The label itself is archetype-only; do NOT include the name in the label.`
    : `The respondent is anonymous. The summary should be in first person ("I lean in just enough to keep up...") OR second person without a name ("You ..."). Write it as if it were them describing themselves.`;

  return [
    "You assign a respondent to ONE of the form's archetypes based on their full answer pattern. The form below has 3–5 archetypes describing the kinds of respondents this form was designed to surface. Your label MUST be exactly one of those — no paraphrasing, no invented categories.",
    "",
    `Form intent: ${formIntent}`,
    "",
    "Archetype options (pick exactly ONE label, character-for-character):",
    archetypeLines,
    "",
    `Allowed labels: ${archetypeLabelList}`,
    "",
    `Subject: ${subject}.`,
    nameInstruction,
    "",
    `${subject}'s answers:`,
    answerLines,
    "",
    "Your task — output strict JSON only, no markdown fences, no preamble:",
    "{",
    `  "label": "<one of the labels above, exact match>",`,
    `  "summary": "<1–2 sentences (max 200 chars) in second person, addressed to the respondent — speak TO them, not ABOUT them. Use 'you' and 'your'. Never use the respondent's name in the summary itself. Never use 'I/I'm/I feel'.>",`,
    `  "highlights": ["<phrase 1>", "<phrase 2>", "<phrase 3>"]`,
    "}",
    "",
    "Hard rules:",
    "- The label must be EXACTLY one of the allowed labels — character-for-character. No paraphrasing.",
    "- highlights MUST be an array of EXACTLY 3 short phrases (each max 60 characters). Draw them from this respondent's specific answers — concrete moments, not generic compliments. Do NOT use phrases like \"engaged with every question\" or \"thoughtful voice\".",
    "- summary MUST be in second person (\"you/your\"). Speak to the respondent directly. Never use first person (\"I feel\"). Never use third person (\"Priya sees\"). Never include the respondent's name in the summary text.",
    "- No markdown fences, no commentary, no preamble. JSON only.",
  ].join("\n");
}

function buildUserMessage(respondentName: string | null): string {
  const subject = respondentName ?? "this respondent";
  return `Classify ${subject} into one of the archetypes above. Strict JSON only.`;
}

// =============================================================================
// Sarvam call with timeout
// =============================================================================

async function callSarvamWithTimeout(
  messages: { role: "system" | "user" | "assistant"; content: string }[]
): Promise<string> {
  // Hard timeout via AbortController inside chatComplete — actually cancels
  // the upstream Sarvam request. Was previously a Promise.race soft timeout
  // that left the request running in the background, compounding rate-limit
  // pressure under concurrent load.
  try {
    const result = await chatComplete(messages, {
      model: SARVAM_MODEL,
      temperature: 0.6,
      max_tokens: 600,
      top_p: 1,
      timeout_ms: SARVAM_TIMEOUT_MS,
      extra_body: {
        chat_template_kwargs: { enable_thinking: false },
      },
    });
    const content = result.choices?.[0]?.message?.content ?? "";
    if (!content) {
      throw new IdentityClassificationError(
        "sarvam",
        "Sarvam returned empty content"
      );
    }
    return content;
  } catch (err) {
    if (err instanceof IdentityClassificationError) throw err;
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new IdentityClassificationError("sarvam", err.message);
    }
    throw new IdentityClassificationError(
      "sarvam",
      err instanceof Error ? err.message : "Sarvam call failed"
    );
  }
}

// =============================================================================
// JSON parsing
// =============================================================================

function stripFences(raw: string): string {
  let s = raw.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  }
  if (!s.startsWith("{")) {
    const match = s.match(/\{[\s\S]*\}/);
    if (match) s = match[0];
  }
  return s.trim();
}

function parseJson(raw: string): unknown {
  const cleaned = stripFences(raw);
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    throw new IdentityClassificationError(
      "parse",
      `Failed to parse Sarvam output as JSON: ${(e as Error).message}`
    );
  }
}

// =============================================================================
// Main entry point
// =============================================================================

export async function classifyIdentity(input: {
  formIntent: string;
  archetypeClusters: ArchetypeCluster[];
  /** Reserved for future use (e.g. richer answer rendering); currently unused. */
  questions?: Question[];
  answers: ClassificationAnswer[];
  respondentName: string | null;
}): Promise<Identity> {
  if (input.archetypeClusters.length === 0) {
    throw new IdentityClassificationError(
      "validation",
      "Form has no archetype clusters; cannot classify identity"
    );
  }
  if (input.answers.length === 0) {
    throw new IdentityClassificationError(
      "validation",
      "No answers to classify; refusing to invent an identity from nothing"
    );
  }

  const allowedLabels = input.archetypeClusters.map((a) => a.label);
  const schema = identitySchemaFor(allowedLabels);

  const systemPrompt = buildSystemPrompt({
    formIntent: input.formIntent,
    archetypeClusters: input.archetypeClusters,
    respondentName: input.respondentName,
    answers: input.answers,
  });
  const userMessage = buildUserMessage(input.respondentName);

  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage },
  ];

  const attemptOutputs: string[] = [];
  let lastIssues: z.ZodIssue[] | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const raw = await callSarvamWithTimeout(messages);
      attemptOutputs.push(raw);

      let parsed: unknown;
      try {
        parsed = parseJson(raw);
      } catch (parseErr) {
        console.error(
          `[identity] attempt ${attempt} parse error:`,
          (parseErr as Error).message
        );
        messages.push({
          role: "system",
          content:
            "Your previous output was not valid JSON. Output strict JSON only — no markdown fences, no preamble.",
        });
        continue;
      }

      const validated = schema.safeParse(parsed);
      if (validated.success) {
        return validated.data;
      }

      lastIssues = validated.error.issues;
      const issuesSummary = lastIssues
        .slice(0, 6)
        .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("\n");
      console.error(
        `[identity] attempt ${attempt} schema validation failed:\n${issuesSummary}`
      );
      messages.push({
        role: "system",
        content: `Your previous output failed validation:\n${issuesSummary}\n\nFix these. Critical rules: label must be EXACTLY one of [${allowedLabels.map((l) => `"${l}"`).join(", ")}] — character-for-character. highlights must be an array of EXACTLY 3 strings. Output strict JSON only.`,
      });
    } catch (err) {
      if (err instanceof IdentityClassificationError) {
        console.error(
          `[identity] attempt ${attempt} ${err.kind} error: ${err.message}`
        );
      } else {
        console.error(`[identity] attempt ${attempt} unexpected error:`, err);
      }
    }
  }

  throw new IdentityClassificationError(
    "validation",
    `Identity classification failed after ${MAX_ATTEMPTS} attempts`,
    { issues: lastIssues, attempts: attemptOutputs }
  );
}
