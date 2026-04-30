import { chatComplete } from "./sarvam";
import {
  seedResponseSchema,
  type SeedResponse,
  type SeedAnswer,
  type Question,
  type Persona,
  type ArchetypeCluster,
} from "./schemas";

/**
 * Stage C — seed response generation pipeline.
 *
 * One Sarvam-105B call per persona, run in parallel via Promise.allSettled.
 * Each call asks the LLM to fully answer the form AS that persona, returning
 * a `SeedResponse`. Output is validated against `seedResponseSchema` and
 * cross-validated against the question options (cards/this_or_that/ranking/
 * visual_select must be literal selections; ranking must be a permutation).
 * Failures retry with the cross-validation issues threaded back into the
 * conversation. After per-persona retries are exhausted, that persona is
 * dropped — Stage C succeeds if at least 7 of 10 personas complete.
 */

// =============================================================================
// Errors
// =============================================================================

export class SeedGenerationError extends Error {
  readonly partialResults?: SeedResponse[];
  constructor(
    message: string,
    extras: { partialResults?: SeedResponse[] } = {}
  ) {
    super(message);
    this.partialResults = extras.partialResults;
    this.name = "SeedGenerationError";
  }
}

// =============================================================================
// Configuration
// =============================================================================

const SARVAM_TIMEOUT_MS = 90_000;
const SARVAM_MODEL = "sarvam-105b";
const MAX_ATTEMPTS_PER_PERSONA = 3;
const MIN_SUCCESSFUL_PERSONAS = 7;

// =============================================================================
// Conversion helper — SeedAnswer → runtime raw_value shape
// =============================================================================

/**
 * Converts a Phase-1 `SeedAnswer` into the `{ type, value }` raw_value shape
 * that the rest of the system (respondent flow, answers route, aggregator)
 * already expects. Voice/text additionally surface the transcript so the
 * answers route's `extractAnswerText()` and reflection engine work uniformly
 * for seed and live answers.
 */
export function seedAnswerToRawValue(answer: SeedAnswer): {
  rawValue: { type: string; value: unknown };
  transcript: string | null;
} {
  switch (answer.input_type) {
    case "name":
      return {
        rawValue: { type: "name", value: answer.value },
        transcript: null,
      };
    case "voice":
      return {
        rawValue: { type: "voice", value: answer.transcript },
        transcript: answer.transcript,
      };
    case "text":
      return {
        rawValue: { type: "text", value: answer.transcript },
        transcript: answer.transcript,
      };
    case "emoji_slider":
      return {
        rawValue: { type: "emoji_slider", value: answer.value },
        transcript: null,
      };
    case "cards":
      return {
        rawValue: { type: "cards", value: answer.selected },
        transcript: null,
      };
    case "ranking":
      return {
        rawValue: { type: "ranking", value: answer.ordered },
        transcript: null,
      };
    case "this_or_that":
      return {
        rawValue: { type: "this_or_that", value: answer.selected },
        transcript: null,
      };
    case "visual_select":
      return {
        rawValue: { type: "visual_select", value: answer.selected },
        transcript: null,
      };
  }
}

// =============================================================================
// Prompt construction
// =============================================================================

function describeQuestion(q: Question, index: number): string {
  const num = `Q${index + 1}`;
  const header = `${num} [${q.input_type}]: ${q.prompt}`;

  switch (q.input_type) {
    case "name":
      return `${header}\n  Answer shape: { "input_type": "name", "value": "<your persona's first name>" }`;
    case "voice":
      return `${header}\n  Answer shape: { "input_type": "voice", "transcript": "..." }\n  1–3 sentences in this persona's specific voice. Max 400 chars.`;
    case "text":
      return `${header}\n  Answer shape: { "input_type": "text", "transcript": "..." }\n  1–3 sentences in this persona's specific voice. Max 400 chars.`;
    case "emoji_slider": {
      const minLabel = q.options.min_label;
      const maxLabel = q.options.max_label;
      return `${header}\n  Answer shape: { "input_type": "emoji_slider", "value": <integer 0–100> }\n  Scale: 0 = "${minLabel}", 100 = "${maxLabel}". Pick a value consistent with this persona's stance.`;
    }
    case "cards":
      return `${header}\n  Answer shape: { "input_type": "cards", "selected": "<EXACT option from list>" }\n  Options: ${JSON.stringify(q.options)}`;
    case "ranking":
      return `${header}\n  Answer shape: { "input_type": "ranking", "ordered": [<all options in this persona's order>] }\n  Options: ${JSON.stringify(q.options)}\n  Must include ALL of these options exactly once, no extras, ordered most-important to least.`;
    case "this_or_that":
      return `${header}\n  Answer shape: { "input_type": "this_or_that", "selected": "<EXACT option from list>" }\n  Options: ${JSON.stringify(q.options)}`;
    case "visual_select": {
      const labels = q.options.map((o) => o.label);
      return `${header}\n  Answer shape: { "input_type": "visual_select", "selected": "<EXACT label from list>" }\n  Options (labels): ${JSON.stringify(labels)}`;
    }
  }
}

function buildSystemPrompt(input: {
  formIntent: string;
  questions: Question[];
  persona: Persona;
  archetype: ArchetypeCluster;
}): string {
  const { formIntent, questions, persona, archetype } = input;

  const questionDescriptions = questions
    .map((q, i) => describeQuestion(q, i))
    .join("\n\n");

  return [
    "You are answering a Pulse survey AS this persona. Stay in their voice for every answer. They are a real character with a coherent worldview — write what THEY would say, not a generic respondent.",
    "",
    "Your persona:",
    `- Name: ${persona.name}`,
    `- Age range: ${persona.age_range}`,
    `- Occupation: ${persona.occupation}`,
    `- Stance: ${persona.stance}`,
    `- Voice quirks: ${persona.voice_quirks}`,
    `- Archetype: "${archetype.label}" — ${archetype.description}`,
    "",
    `Form intent (context for what's being asked): ${formIntent}`,
    "",
    `Answer each of the ${questions.length} questions below in order, returning one SeedAnswer per question.`,
    "",
    questionDescriptions,
    "",
    "Output strict JSON only. No markdown fences. No preamble. Format:",
    "{",
    `  "persona_name": "${persona.name}",`,
    '  "answers": [',
    "    <SeedAnswer for Q1>,",
    "    <SeedAnswer for Q2>,",
    "    ...",
    "  ]",
    "}",
    "",
    "Hard rules:",
    `- The "answers" array must have EXACTLY ${questions.length} elements, in question order (Q1 first).`,
    "- For closed-input questions (cards, this_or_that, ranking, visual_select), you MUST select literally from the provided options. Do NOT paraphrase, abbreviate, or invent. Copy the exact string character-for-character.",
    "- For ranking, return ALL options in this persona's preferred order. No omissions, no additions, no duplicates. Most important first.",
    "- For voice/text, write 1–3 sentences in this persona's specific voice. Use their voice_quirks. Sound like THEM, not a generic survey respondent.",
    `- "persona_name" must equal "${persona.name}".`,
    "- Output JSON only. No markdown, no explanations.",
  ].join("\n");
}

function buildUserMessage(
  persona: Persona,
  questionsLength: number
): string {
  return `Answer all ${questionsLength} questions as ${persona.name}. Strict JSON only.`;
}

// =============================================================================
// Sarvam call with timeout
// =============================================================================

async function callSarvamWithTimeout(
  messages: { role: "system" | "user" | "assistant"; content: string }[]
): Promise<string> {
  const result = await Promise.race([
    chatComplete(messages, {
      model: SARVAM_MODEL,
      temperature: 0.85,
      max_tokens: 2000,
      top_p: 1,
      extra_body: {
        chat_template_kwargs: { enable_thinking: false },
      },
    }),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Sarvam call exceeded ${SARVAM_TIMEOUT_MS}ms`)),
        SARVAM_TIMEOUT_MS
      )
    ),
  ]);
  const content = result.choices?.[0]?.message?.content ?? "";
  if (!content) throw new Error("Sarvam returned empty content");
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
  if (!s.startsWith("{")) {
    const match = s.match(/\{[\s\S]*\}/);
    if (match) s = match[0];
  }
  return s.trim();
}

// =============================================================================
// Cross-validation against question options
// =============================================================================

function crossValidate(
  response: SeedResponse,
  questions: Question[],
  persona: Persona
): string[] {
  const issues: string[] = [];

  if (response.persona_name !== persona.name) {
    issues.push(
      `persona_name "${response.persona_name}" does not match expected "${persona.name}"`
    );
  }

  if (response.answers.length !== questions.length) {
    issues.push(
      `answers length ${response.answers.length} does not match expected ${questions.length}`
    );
    return issues;
  }

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const a = response.answers[i];
    const qNum = `Q${i + 1}`;

    if (a.input_type !== q.input_type) {
      issues.push(
        `${qNum}: answer input_type "${a.input_type}" does not match question input_type "${q.input_type}"`
      );
      continue;
    }

    switch (a.input_type) {
      case "name": {
        if (a.value !== persona.name) {
          issues.push(
            `${qNum} (name): value "${a.value}" must equal persona name "${persona.name}"`
          );
        }
        break;
      }
      case "cards": {
        if (q.input_type !== "cards") break;
        if (!q.options.includes(a.selected)) {
          issues.push(
            `${qNum} (cards): "${a.selected}" is not in options ${JSON.stringify(q.options)}`
          );
        }
        break;
      }
      case "this_or_that": {
        if (q.input_type !== "this_or_that") break;
        if (!q.options.includes(a.selected)) {
          issues.push(
            `${qNum} (this_or_that): "${a.selected}" is not in options ${JSON.stringify(q.options)}`
          );
        }
        break;
      }
      case "ranking": {
        if (q.input_type !== "ranking") break;
        const expected = q.options;
        if (a.ordered.length !== expected.length) {
          issues.push(
            `${qNum} (ranking): ordered has ${a.ordered.length} items but should be a permutation of ${expected.length} options ${JSON.stringify(expected)}`
          );
          break;
        }
        const expectedSet = new Set(expected);
        const seen = new Set<string>();
        for (const item of a.ordered) {
          if (!expectedSet.has(item)) {
            issues.push(
              `${qNum} (ranking): "${item}" is not in options ${JSON.stringify(expected)}`
            );
          }
          if (seen.has(item)) {
            issues.push(
              `${qNum} (ranking): "${item}" appears more than once`
            );
          }
          seen.add(item);
        }
        for (const opt of expected) {
          if (!seen.has(opt)) {
            issues.push(
              `${qNum} (ranking): missing option "${opt}" — must be a permutation`
            );
          }
        }
        break;
      }
      case "visual_select": {
        if (q.input_type !== "visual_select") break;
        const labels = q.options.map((o) => o.label);
        if (!labels.includes(a.selected)) {
          issues.push(
            `${qNum} (visual_select): "${a.selected}" is not a label in options ${JSON.stringify(labels)}`
          );
        }
        break;
      }
      // voice / text / emoji_slider have no option-level cross-check.
    }
  }

  return issues;
}

// =============================================================================
// Per-persona generation (with retry)
// =============================================================================

async function generateOnePersonaResponse(
  persona: Persona,
  archetype: ArchetypeCluster,
  questions: Question[],
  formIntent: string,
  index: number
): Promise<SeedResponse | null> {
  const label = `phase-3:stage-c:persona-${index}-${persona.name}`;
  console.time(label);

  const systemPrompt = buildSystemPrompt({
    formIntent,
    questions,
    persona,
    archetype,
  });
  const userMessage = buildUserMessage(persona, questions.length);

  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage },
  ];

  try {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_PERSONA; attempt++) {
      try {
        const raw = await callSarvamWithTimeout(messages);
        const cleaned = stripFences(raw);

        let parsed: unknown;
        try {
          parsed = JSON.parse(cleaned);
        } catch (e) {
          console.error(
            `[seed-generation] persona ${index} (${persona.name}) attempt ${attempt} parse error: ${(e as Error).message}`
          );
          messages.push({
            role: "system",
            content:
              "Your previous output was not valid JSON. Output strict JSON only — no markdown fences, no preamble.",
          });
          continue;
        }

        const schemaResult = seedResponseSchema.safeParse(parsed);
        if (!schemaResult.success) {
          const issuesSummary = schemaResult.error.issues
            .slice(0, 6)
            .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
            .join("\n");
          console.error(
            `[seed-generation] persona ${index} (${persona.name}) attempt ${attempt} schema error:\n${issuesSummary}`
          );
          messages.push({
            role: "system",
            content: `Your previous output failed schema validation:\n${issuesSummary}\n\nFix these and output strict JSON only.`,
          });
          continue;
        }

        const issues = crossValidate(schemaResult.data, questions, persona);
        if (issues.length > 0) {
          const issuesSummary = issues
            .slice(0, 6)
            .map((m) => `  - ${m}`)
            .join("\n");
          console.error(
            `[seed-generation] persona ${index} (${persona.name}) attempt ${attempt} cross-validation failed:\n${issuesSummary}`
          );
          messages.push({
            role: "system",
            content: `Your previous output had answers that don't match the questions' valid options:\n${issuesSummary}\n\nFix these. For closed-input questions, copy the option string EXACTLY as provided — character-for-character. No paraphrasing, no abbreviating.`,
          });
          continue;
        }

        return schemaResult.data;
      } catch (err) {
        console.error(
          `[seed-generation] persona ${index} (${persona.name}) attempt ${attempt} error:`,
          err instanceof Error ? err.message : err
        );
      }
    }

    console.error(
      `[seed-generation] persona ${index} (${persona.name}) failed after ${MAX_ATTEMPTS_PER_PERSONA} attempts; dropping`
    );
    return null;
  } finally {
    console.timeEnd(label);
  }
}

// =============================================================================
// Main entry point
// =============================================================================

export async function generateSeedResponses(input: {
  formIntent: string;
  questions: Question[];
  personas: Persona[];
  archetypeClusters: ArchetypeCluster[];
}): Promise<SeedResponse[]> {
  console.time("phase-3:stage-c:wall");

  const { formIntent, questions, personas, archetypeClusters } = input;
  const archetypeByLabel = new Map(
    archetypeClusters.map((a) => [a.label, a])
  );

  try {
    const settled = await Promise.allSettled(
      personas.map((persona, i) => {
        const archetype = archetypeByLabel.get(persona.archetype_label);
        if (!archetype) {
          // Defensive: persona-generation should have caught this, but if a
          // persona slipped through with an unknown label, drop it instead of
          // crashing the whole stage.
          console.error(
            `[seed-generation] persona ${i} (${persona.name}) has unknown archetype "${persona.archetype_label}"; dropping`
          );
          return Promise.resolve<SeedResponse | null>(null);
        }
        return generateOnePersonaResponse(
          persona,
          archetype,
          questions,
          formIntent,
          i
        );
      })
    );

    const successes: SeedResponse[] = [];
    for (const r of settled) {
      if (r.status === "fulfilled" && r.value) {
        successes.push(r.value);
      }
    }

    console.log(
      `[seed-generation] Stage C results: ${successes.length}/${personas.length} personas succeeded`
    );

    if (successes.length < MIN_SUCCESSFUL_PERSONAS) {
      throw new SeedGenerationError(
        `Stage C: only ${successes.length}/${personas.length} personas succeeded (min ${MIN_SUCCESSFUL_PERSONAS})`,
        { partialResults: successes }
      );
    }

    return successes;
  } finally {
    console.timeEnd("phase-3:stage-c:wall");
  }
}
