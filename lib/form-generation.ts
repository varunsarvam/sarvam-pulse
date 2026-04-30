import { z } from "zod";
import { chatComplete } from "./sarvam";
import {
  formGenerationOutputSchemaFor,
  inputTypeSchema,
  LENGTH_LIMITS,
  NAME_QUESTION_PROMPT,
  type FormGenerationOutput,
  type InputTypeSchema,
} from "./schemas";

/**
 * Stage A — form generation pipeline.
 *
 * Turns user-provided form intent + per-question intents into a fully
 * realized form (phrasings + matched options + 3–5 archetype clusters)
 * by calling Sarvam-105B, validates against the Phase 1 schema, retries
 * on failure, and returns the validated payload for persistence.
 */

// =============================================================================
// Input types
// =============================================================================

const userFacingInputTypes = [
  "voice",
  "text",
  "emoji_slider",
  "cards",
  "ranking",
  "this_or_that",
  "visual_select",
] as const satisfies readonly Exclude<InputTypeSchema, "name">[];

export const userFacingInputTypeSchema = z.enum(userFacingInputTypes);
export type UserFacingInputType = z.infer<typeof userFacingInputTypeSchema>;

export const formGenerationInputSchema = z.object({
  formTitle: z.string().min(1).max(200),
  formIntent: z.string().min(1).max(2000),
  tone: z.enum(["playful", "calm", "direct", "insightful"]),
  anonymous: z.boolean(),
  questionIntents: z
    .array(
      z.object({
        intent: z.string().min(1).max(500),
        input_type: inputTypeSchema.refine((t) => t !== "name", {
          message: "input_type 'name' is system-managed; do not request it",
        }),
      })
    )
    .min(1)
    .max(20),
});
export type FormGenerationInput = z.infer<typeof formGenerationInputSchema>;

// =============================================================================
// Errors
// =============================================================================

export class FormGenerationError extends Error {
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
    this.name = "FormGenerationError";
  }
}

// =============================================================================
// Prompt construction
// =============================================================================

const TONE_GUIDANCE: Record<FormGenerationInput["tone"], string> = {
  playful:
    "warm, conversational, a touch of wit. like a smart friend who's curious about your answer.",
  calm: "slow, considered, gentle. invites reflection without pressure.",
  direct:
    "crisp and plain-spoken. no preamble, no metaphors. respect the respondent's time.",
  insightful:
    "evocative and thoughtful. questions feel like they were asked by someone who really wants to know.",
};

const INPUT_TYPE_RULES: Record<UserFacingInputType, string> = {
  voice:
    "open-ended; no options. The respondent answers by speaking. Phrase it so a 1–3 sentence verbal answer feels natural.",
  text: "open-ended; no options. The respondent types a short answer. Phrase it so a 1–3 sentence written answer feels natural.",
  emoji_slider:
    "a 0–100 sentiment slider. Generate options: { min_label, max_label } that match the question's actual scale (e.g. frequency: 'Never'/'Constantly'; comfort: 'Uneasy'/'At ease'; agreement: 'Definitely not'/'Absolutely'). 1–3 words each. Never default to 'Strongly disagree'/'Strongly agree' unless the question is literally an agreement statement.",
  cards:
    "produce 4–6 string options that span the realistic answer space for this question. Options should be parallel in form, mutually distinct, and feel like real human stances — not abstract category names.",
  ranking:
    "produce exactly 4 string items that the respondent will drag into their preferred order. Items must be roughly equally important so ranking is genuine, not obvious.",
  this_or_that:
    "produce exactly 2 string options representing a real, sharp contrast. Avoid false dichotomies — both options should be defensible.",
  visual_select:
    "produce 4–6 options as objects { label, image_url }. Use 'https://placeholder.test/<slug>.png' for image_url where <slug> is a kebab-case version of the label. Real images come later.",
};

function buildSystemPrompt(input: FormGenerationInput): string {
  return [
    "You are the form generator for Pulse — a conversational survey product where respondents answer one question at a time, each in a tailored input type, and receive a personalized identity card at the end.",
    "",
    `Form tone: ${input.tone} — ${TONE_GUIDANCE[input.tone]}`,
    `Form title: ${input.formTitle}`,
    `Form intent: ${input.formIntent}`,
    "",
    "Your job: for each question intent the user provides, write the final phrasing of the question in the form's tone, and (where applicable) generate the options that match the input type. Then generate 3–5 archetype_clusters describing the kinds of respondents this form will surface.",
    "",
    "Output strict JSON only. No markdown fences. No preamble. No commentary. The JSON must match this shape exactly:",
    "{",
    '  "questions": [',
    '    { "prompt": string, "position": int, "input_type": "voice"|"text"|"emoji_slider"|"cards"|"ranking"|"this_or_that"|"visual_select", "options": null | { "min_label": string, "max_label": string } | string[] | { "label": string, "image_url": string }[] }',
    "  ],",
    '  "archetype_clusters": [',
    '    { "label": string (2–4 words), "description": string (1–2 sentences), "indicator_signals": string[] (≥1) }',
    "  ]",
    "}",
    "",
    "Question rules:",
    `- prompt: 1–2 sentences, max ${LENGTH_LIMITS.questionPrompt} characters. Match the form tone. Never echo the intent verbatim.`,
    "- position: zero-indexed, in the order given. Question 0 is the first question, then 1, 2, ...",
    "- input_type must match the input type given for that intent.",
    "- For input types where options is null (name, voice, text), produce only the question prompt as plain text. Do not embed emojis, labels, or examples within the prompt itself.",
    "- options shape must match the input_type:",
    "  - voice / text: options is null.",
    `  - emoji_slider: options is { "min_label": string, "max_label": string }. Each 1–3 words, max ${LENGTH_LIMITS.emojiSliderLabel} characters each.`,
    `  - cards: 4–6 strings, each max ${LENGTH_LIMITS.cardsOption} characters.`,
    `  - ranking: exactly 4 strings, each max ${LENGTH_LIMITS.rankingOption} characters.`,
    `  - this_or_that: exactly 2 strings, each max ${LENGTH_LIMITS.thisOrThatOption} characters.`,
    `  - visual_select: 4–6 objects with { "label": string (max ${LENGTH_LIMITS.visualSelectLabel} chars), "image_url": string }. Use https://placeholder.test/<kebab-slug>.png for image_url.`,
    "",
    "Option-quality rules:",
    "- Options must be plausible answers to THIS question, not generic. Reading them, the respondent should think 'one of these is me'.",
    "- For cards: span the realistic stance space (e.g. for AI comfort: 'I avoid it', 'I dabble', 'I use it daily', 'I build with it'). Parallel form. No 'Other'.",
    "- For this_or_that: a real, sharp contrast. Both sides defensible.",
    "- For ranking: 4 items of roughly equal weight.",
    "- For visual_select: distinct visual concepts.",
    "",
    "LENGTH AND VOICE CONSTRAINTS — strictly follow:",
    "",
    "Length limits:",
    "- Question prompts: aim 60-110 characters, hard cap 130. Questions should feel like a moment, not a paragraph.",
    "- cards options: max 32 characters. Use evocative metaphors or self-descriptions. NOT explanations.",
    '  Good: "A research partner", "A shortcut machine", "I mostly avoid it"',
    '  Bad:  "AI is a tool I use as a research assistant for finding information"',
    "- this_or_that options: max 40 characters. Two contrasting positions, each terse.",
    '  Good: "Helpful tool" / "Threat to jobs"',
    '  Bad:  "AI will create more fulfilling work" / "AI will displace more jobs than it creates"',
    "- ranking options: max 44 characters. Concrete nouns or short noun phrases.",
    '  Good: "Losing my job", "Privacy and surveillance", "AI making decisions about me"',
    '  Bad:  "The possibility that AI will make decisions about me without my knowledge"',
    "- visual_select labels: max 28 characters. Even shorter than cards.",
    `- emoji_slider min_label / max_label: max ${LENGTH_LIMITS.emojiSliderLabel} characters each. 1–3 words.`,
    "- Archetype labels: max 32 characters",
    "- Archetype descriptions: max 200 characters",
    "- Indicator signals: max 80 characters each",
    "",
    "Voice rules:",
    "- Options should feel like poetry, not policy. Terse over comprehensive.",
    '- Never use phrases like "AI will...", "...leading to...", "...because of..." in options. Options are not sentences.',
    "- Question prompts should ask one thing, evocatively. No multi-clause questions.",
    "",
    "GOOD QUESTIONS — pattern-match these for voice and rhythm:",
    "",
    'Example 1 (insightful, voice input):',
    '"Forget the headlines — when AI comes up for you, what\'s the one thing that genuinely makes your stomach clench?"',
    "",
    'Example 2 (insightful, cards input):',
    '"What does your actual daily interaction with AI look like in practice?"',
    "",
    'Example 3 (calm, this_or_that input):',
    '"When AI surprises you in your work, what\'s the first feeling that surfaces?"',
    "",
    'Example 4 (playful, ranking input):',
    '"If AI keeps getting better, which of these would you protect first?"',
    "",
    'Example 5 (direct, emoji_slider input):',
    '"How often does AI actually save you time on real work?"',
    "",
    "Patterns to notice:",
    "- Every question is a complete, grammatical sentence ending with '?'",
    "- They ask one thing, specifically, with embodied language (stomach clench, feel, save time)",
    "- They avoid generic abstractions ('perspective', 'thoughts', 'views')",
    "- They're written in second person ('you', 'your') — direct, intimate",
    "- They earn their length with specificity, not filler",
    "",
    "QUESTION QUALITY RULES — strictly follow:",
    "",
    "- Every question must be a complete, grammatical sentence ending with a question mark.",
    "- Use second-person voice ('you', 'your'). Never write 'one's perspective' or 'people's views'.",
    "- Avoid noun-phrase questions ('Your thoughts on AI?'). Always full sentence-form.",
    "- Avoid generic openers like 'What do you think about...' or 'How do you feel about...'.",
    "- Avoid abstract nouns like 'perspective', 'thoughts', 'views', 'opinions'. Replace with embodied or specific language.",
    "- One concrete idea per question. No multi-clause questions joining with 'and'.",
    "- Read each question aloud in your head. If it doesn't flow, rewrite it.",
    "",
    "EMOJI_SLIDER LABELS:",
    "",
    "For every emoji_slider question, generate min_label and max_label that match the question's actual scale.",
    "",
    "Examples:",
    "",
    'Question: "How often do you use AI tools in your daily work?"',
    '  min_label: "Never"',
    '  max_label: "Constantly"',
    "",
    'Question: "How comfortable are you with AI making decisions for you?"',
    '  min_label: "Uneasy"',
    '  max_label: "At ease"',
    "",
    'Question: "How likely are you to recommend AI tools to a friend?"',
    '  min_label: "Never would"',
    '  max_label: "Already do"',
    "",
    'Question: "How much has AI changed how you work?"',
    '  min_label: "Not at all"',
    '  max_label: "Completely"',
    "",
    "Never use generic 'Strongly disagree' / 'Strongly agree' unless the question is literally an agreement statement. Match the question's verb.",
    "",
    "Archetype rules:",
    `- 3–5 clusters per form. Labels are short, evocative, 2–4 words, max ${LENGTH_LIMITS.archetypeLabel} characters (e.g. 'Cautious Adopter', 'Quiet Skeptic'). No two clusters share a label.`,
    `- description is 1–2 sentences, max ${LENGTH_LIMITS.archetypeDescription} characters.`,
    `- indicator_signals is an array of phrases or behaviors that mark someone as this archetype, drawn from the kinds of answers they'd give to THESE questions. At least 2 signals per cluster, each max ${LENGTH_LIMITS.archetypeSignal} characters.`,
    "- Together the clusters should partition the realistic respondent space — distinct, useful for downstream identity classification.",
    "",
    "Hard rules:",
    "- Output JSON only. No code fences, no preamble, no explanations.",
    "- Do not include a name question. The system handles that separately.",
    "- Do not invent input types not listed. Do not add fields not listed.",
    "- Respect every length cap. Outputs that exceed any cap will be rejected and you will be asked to retry.",
  ].join("\n");
}

function buildUserMessage(input: FormGenerationInput): string {
  const lines: string[] = [];
  lines.push("Generate the form for these question intents (in order):");
  lines.push("");
  input.questionIntents.forEach((q, i) => {
    lines.push(
      `${i}. intent: ${q.intent}\n   input_type: ${q.input_type}\n   constraints: ${INPUT_TYPE_RULES[q.input_type as UserFacingInputType]}`
    );
  });
  lines.push("");
  lines.push(
    `Output ${input.questionIntents.length} questions (positions 0..${input.questionIntents.length - 1}) and 3–5 archetype_clusters. Strict JSON only.`
  );
  return lines.join("\n");
}

// =============================================================================
// Sarvam call with timeout
// =============================================================================

const SARVAM_TIMEOUT_MS = 90_000;
const SARVAM_MODEL = "sarvam-105b";

async function callSarvamWithTimeout(
  messages: { role: "system" | "user" | "assistant"; content: string }[]
): Promise<string> {
  const result = await Promise.race([
    chatComplete(messages, {
      model: SARVAM_MODEL,
      temperature: 0.6,
      max_tokens: 2000,
      top_p: 1,
      extra_body: {
        chat_template_kwargs: { enable_thinking: false },
      },
    }),
    new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new FormGenerationError(
              "sarvam",
              `Sarvam call exceeded ${SARVAM_TIMEOUT_MS}ms timeout`
            )
          ),
        SARVAM_TIMEOUT_MS
      )
    ),
  ]);
  const content = result.choices?.[0]?.message?.content ?? "";
  if (!content) {
    throw new FormGenerationError("sarvam", "Sarvam returned empty content");
  }
  return content;
}

// =============================================================================
// JSON parsing
// =============================================================================

function stripFences(raw: string): string {
  let s = raw.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  }
  // If there's leading commentary, grab the largest balanced { ... } block.
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
    throw new FormGenerationError(
      "parse",
      `Failed to parse Sarvam output as JSON: ${(e as Error).message}`
    );
  }
}

// =============================================================================
// Post-processing
// =============================================================================

/**
 * Inserts the auto-managed name question at position 0 (and shifts the LLM's
 * questions by +1) when the form is non-anonymous. Anonymous mode passes
 * through unchanged.
 */
function postProcessQuestions(
  llmJson: unknown,
  anonymous: boolean
): unknown {
  if (
    typeof llmJson !== "object" ||
    llmJson === null ||
    !("questions" in llmJson) ||
    !Array.isArray((llmJson as { questions: unknown }).questions)
  ) {
    return llmJson;
  }
  const obj = llmJson as { questions: unknown[]; [k: string]: unknown };
  const llmQuestions = obj.questions;

  if (anonymous) {
    return obj;
  }

  const shifted = llmQuestions.map((q, i) => {
    if (typeof q === "object" && q !== null) {
      return { ...(q as Record<string, unknown>), position: i + 1 };
    }
    return q;
  });

  const nameQuestion = {
    prompt: NAME_QUESTION_PROMPT,
    position: 0,
    input_type: "name",
    options: null,
  };

  return { ...obj, questions: [nameQuestion, ...shifted] };
}

// =============================================================================
// Main entry point
// =============================================================================

const MAX_ATTEMPTS = 3;

export async function generateForm(
  input: FormGenerationInput
): Promise<FormGenerationOutput> {
  const parsedInput = formGenerationInputSchema.parse(input);

  console.time("form-generation:total");

  const systemPrompt = buildSystemPrompt(parsedInput);
  const userMessage = buildUserMessage(parsedInput);
  const schema = formGenerationOutputSchemaFor({
    anonymous: parsedInput.anonymous,
  });

  const messages: { role: "system" | "user" | "assistant"; content: string }[] =
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ];

  const attemptOutputs: string[] = [];
  let lastIssues: z.ZodIssue[] | undefined;

  try {
   for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const label = `form-generation:attempt-${attempt}`;
    console.time(label);
    try {
      const raw = await callSarvamWithTimeout(messages);
      attemptOutputs.push(raw);

      let parsed: unknown;
      try {
        parsed = parseJson(raw);
      } catch (parseErr) {
        console.error(
          `[form-generation] attempt ${attempt} parse error:`,
          (parseErr as Error).message
        );
        messages.push({
          role: "system",
          content:
            "Your previous output was not valid JSON. Output strict JSON only, matching the schema exactly. No markdown fences, no preamble.",
        });
        continue;
      }

      const processed = postProcessQuestions(parsed, parsedInput.anonymous);
      const validated = schema.safeParse(processed);

      if (validated.success) {
        return validated.data;
      }

      lastIssues = validated.error.issues;
      const issuesSummary = lastIssues
        .slice(0, 8)
        .map(
          (issue) =>
            `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`
        )
        .join("\n");
      console.error(
        `[form-generation] attempt ${attempt} schema validation failed:\n${issuesSummary}`
      );
      messages.push({
        role: "system",
        content: `Your previous output failed schema validation. Errors:\n${issuesSummary}\n\nFix these issues. Output strict JSON only, matching the schema exactly.`,
      });
    } catch (err) {
      if (err instanceof FormGenerationError) {
        console.error(
          `[form-generation] attempt ${attempt} ${err.kind} error: ${err.message}`
        );
        if (err.kind === "sarvam") {
          // Sarvam-side failures: retry without modifying the conversation.
        }
      } else {
        console.error(
          `[form-generation] attempt ${attempt} unexpected error:`,
          err
        );
      }
      // fall through to retry
    } finally {
      console.timeEnd(label);
    }
   }
  } finally {
    console.timeEnd("form-generation:total");
  }

  throw new FormGenerationError(
    "validation",
    `Form generation failed after ${MAX_ATTEMPTS} attempts`,
    { issues: lastIssues, attempts: attemptOutputs }
  );
}
