import { z } from "zod";
import { chatComplete } from "./sarvam";
import {
  personaSchema,
  LENGTH_LIMITS,
  type Persona,
  type Question,
  type ArchetypeCluster,
} from "./schemas";

/**
 * Stage B — persona generation pipeline.
 *
 * Single Sarvam-105B call that returns 10 personas tied to the form's
 * archetype clusters. Output is validated against `personaSchema` and
 * cross-checked against the archetype label set. Failures retry with
 * the validation issues threaded back into the conversation, mirroring
 * Phase 2's retry pattern.
 */

// =============================================================================
// Errors
// =============================================================================

export class PersonaGenerationError extends Error {
  readonly kind: "validation" | "sarvam" | "parse";
  readonly issues?: string[];
  readonly attempts?: string[];
  constructor(
    kind: "validation" | "sarvam" | "parse",
    message: string,
    extras: { issues?: string[]; attempts?: string[] } = {}
  ) {
    super(message);
    this.kind = kind;
    this.issues = extras.issues;
    this.attempts = extras.attempts;
    this.name = "PersonaGenerationError";
  }
}

// =============================================================================
// Configuration
// =============================================================================

const SARVAM_TIMEOUT_MS = 90_000;
const SARVAM_MODEL = "sarvam-105b";
const TARGET_PERSONA_COUNT = 10;
const MAX_ATTEMPTS = 3;

// =============================================================================
// Prompt construction
// =============================================================================

function buildSystemPrompt(input: {
  formTitle: string;
  formIntent: string;
  questions: Question[];
  archetypeClusters: ArchetypeCluster[];
}): string {
  const { formTitle, formIntent, questions, archetypeClusters } = input;

  const questionLines = questions
    .map((q, i) => `  ${i + 1}. [${q.input_type}] ${q.prompt}`)
    .join("\n");

  const archetypeLines = archetypeClusters
    .map((a) => {
      const signals = a.indicator_signals.slice(0, 3).join("; ");
      return `- "${a.label}" — ${a.description}\n  Signals: ${signals}`;
    })
    .join("\n");

  const archetypeLabelList = archetypeClusters
    .map((a) => `"${a.label}"`)
    .join(", ");

  return [
    "You generate synthetic respondents (personas) for Pulse, a conversational survey product. Each persona will later answer the form's questions in a coherent voice — they are characters with worldviews, not abstractions.",
    "",
    `Form title: ${formTitle}`,
    `Form intent: ${formIntent}`,
    "",
    "Questions on this form:",
    questionLines,
    "",
    "Archetype clusters this form recognizes:",
    archetypeLines,
    "",
    `Generate exactly ${TARGET_PERSONA_COUNT} personas distributed across the archetypes. Uneven distribution is expected and encouraged (e.g. 3+3+2+2 or 3+2+2+2+1). Pick a distribution based on which archetypes deserve more variety to surface interesting answers.`,
    "",
    "Per-persona schema:",
    `- name: ONE WORD ONLY — a first name with NO surname, NO middle name, NO whitespace. "Priya" is correct. "Priya Sharma" is WRONG and will be rejected. Mix cultures — Indian, East Asian, Latin American, African, European, Middle Eastern. NOT all Western-default like Sarah/Mike/John. At least 4 of the 10 names should be non-Western. Max ${LENGTH_LIMITS.personaName} characters.`,
    `- age_range: One of "18-24", "25-34", "35-44", "45-54", "55+".`,
    `- occupation: One concrete sentence with a real job title. Not "professional" or "office worker". E.g. "Mid-level product designer at a SaaS startup, ships weekly." or "Senior nurse at a public hospital, switching to night shifts."`,
    `- stance: 1–2 sentences describing the worldview that makes this persona's answers coherent. The lens through which they see the form's subject. Max ${LENGTH_LIMITS.personaStance} characters.`,
    `- voice_quirks: 1–2 sentences capturing speech patterns. SPECIFIC and DIFFERENT per persona — short clipped sentences vs flowing, hedging ("I guess", "honestly", "tbh", "kind of"), certainty markers ("clearly", "obviously", "no question"), filler ("like", "you know"), slang, idioms, words they avoid. Each persona should sound IDENTIFIABLY DIFFERENT. Max ${LENGTH_LIMITS.personaVoiceQuirks} characters.`,
    `- archetype_label: Must EXACTLY match one of: ${archetypeLabelList}. No paraphrases. No new labels.`,
    "",
    "Output strict JSON only. No markdown fences. No preamble. No commentary. Format:",
    "[",
    "  {",
    '    "name": string,',
    '    "age_range": string,',
    '    "occupation": string,',
    '    "stance": string,',
    '    "voice_quirks": string,',
    '    "archetype_label": string',
    "  },",
    `  ... ${TARGET_PERSONA_COUNT} entries total`,
    "]",
    "",
    "Hard rules:",
    `- The array must contain EXACTLY ${TARGET_PERSONA_COUNT} personas.`,
    "- archetype_label values must be exact matches from the provided list.",
    "- Voice quirks must DIFFER meaningfully between personas — no two should sound the same.",
    "- Names must mix cultures. At least 4 non-Western-default names.",
    "- Output JSON only. No markdown fences, no explanations.",
    "- Respect every length cap; output exceeding caps will be rejected.",
  ].join("\n");
}

function buildUserMessage(): string {
  return `Generate ${TARGET_PERSONA_COUNT} personas now. Strict JSON array only.`;
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
      temperature: 0.8,
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
            new PersonaGenerationError(
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
    throw new PersonaGenerationError("sarvam", "Sarvam returned empty content");
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
  if (!s.startsWith("[")) {
    const match = s.match(/\[[\s\S]*\]/);
    if (match) s = match[0];
  }
  return s.trim();
}

function parseJson(raw: string): unknown {
  const cleaned = stripFences(raw);
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    throw new PersonaGenerationError(
      "parse",
      `Failed to parse Sarvam output as JSON: ${(e as Error).message}`
    );
  }
}

// =============================================================================
// Validation (schema + cross-check against archetype label set)
// =============================================================================

const personaArraySchema = z.array(personaSchema);

function validateOutput(
  raw: unknown,
  archetypeLabels: Set<string>
): { ok: true; data: Persona[] } | { ok: false; issues: string[] } {
  const parseResult = personaArraySchema.safeParse(raw);
  if (!parseResult.success) {
    return {
      ok: false,
      issues: parseResult.error.issues
        .slice(0, 8)
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    };
  }
  const personas = parseResult.data;

  const issues: string[] = [];

  if (personas.length !== TARGET_PERSONA_COUNT) {
    issues.push(
      `expected exactly ${TARGET_PERSONA_COUNT} personas, got ${personas.length}`
    );
  }

  for (let i = 0; i < personas.length; i++) {
    if (!archetypeLabels.has(personas[i].archetype_label)) {
      issues.push(
        `personas[${i}].archetype_label "${personas[i].archetype_label}" is not in the form's archetype list`
      );
    }
  }

  if (issues.length > 0) return { ok: false, issues };

  return { ok: true, data: personas };
}

// =============================================================================
// Main entry point
// =============================================================================

export async function generatePersonas(input: {
  formTitle: string;
  formIntent: string;
  questions: Question[];
  archetypeClusters: ArchetypeCluster[];
}): Promise<Persona[]> {
  console.time("phase-3:stage-b:total");

  const archetypeLabels = new Set(input.archetypeClusters.map((a) => a.label));

  const systemPrompt = buildSystemPrompt(input);
  const userMessage = buildUserMessage();

  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage },
  ];

  const attemptOutputs: string[] = [];
  let lastIssues: string[] | undefined;

  try {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const label = `phase-3:stage-b:attempt-${attempt}`;
      console.time(label);
      try {
        const raw = await callSarvamWithTimeout(messages);
        attemptOutputs.push(raw);

        let parsed: unknown;
        try {
          parsed = parseJson(raw);
        } catch (parseErr) {
          console.error(
            `[persona-generation] attempt ${attempt} parse error:`,
            (parseErr as Error).message
          );
          messages.push({
            role: "system",
            content:
              "Your previous output was not valid JSON. Output a strict JSON array only — no markdown fences, no preamble.",
          });
          continue;
        }

        const validated = validateOutput(parsed, archetypeLabels);
        if (validated.ok) {
          return validated.data;
        }

        lastIssues = validated.issues;
        const issuesSummary = validated.issues
          .slice(0, 8)
          .map((m) => `  - ${m}`)
          .join("\n");
        console.error(
          `[persona-generation] attempt ${attempt} validation failed:\n${issuesSummary}`
        );
        messages.push({
          role: "system",
          content: `Your previous output failed validation. Errors:\n${issuesSummary}\n\nFix these issues and output strict JSON only, matching the schema exactly.`,
        });
      } catch (err) {
        if (err instanceof PersonaGenerationError) {
          console.error(
            `[persona-generation] attempt ${attempt} ${err.kind} error: ${err.message}`
          );
        } else {
          console.error(
            `[persona-generation] attempt ${attempt} unexpected error:`,
            err
          );
        }
      } finally {
        console.timeEnd(label);
      }
    }
  } finally {
    console.timeEnd("phase-3:stage-b:total");
  }

  throw new PersonaGenerationError(
    "validation",
    `Persona generation failed after ${MAX_ATTEMPTS} attempts`,
    { issues: lastIssues, attempts: attemptOutputs }
  );
}
