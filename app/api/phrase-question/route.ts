import { NextRequest, NextResponse } from "next/server";
import { chatComplete } from "@/lib/sarvam";

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Sarvam models embed <think>…</think> chain-of-thought before the final answer.
// Strip it so we only return the actual rewritten question.
function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

// ─── In-memory cache ──────────────────────────────────────────────────────────
// Keyed by JSON.stringify({ session_id, question_prompt, tone, form_intent }).
// Per-session: same session gets the same phrasing; different sessions get
// fresh LLM calls so each respondent experiences unique language.
// If session_id is absent the call is treated as one-off (no caching).

const cache = new Map<string, string>();

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { question_prompt, tone, form_intent, previous_answers, session_id } =
      await req.json();

    if (!question_prompt || !tone) {
      return NextResponse.json(
        { error: "question_prompt and tone are required." },
        { status: 400 }
      );
    }

    const cacheKey = session_id
      ? JSON.stringify({ session_id, question_prompt, tone, form_intent })
      : null;

    if (cacheKey) {
      const cached = cache.get(cacheKey);
      if (cached) return NextResponse.json({ phrased: cached });
    }

    const examplesBlock = `
Examples of what variation looks like (for tone='insightful'):

Original: 'How do you feel about working from home?'
Good rewrites:
- 'Set the policies aside for a moment — how does working from home actually feel for you?'
- 'When you picture your workday at home, what's the honest emotional truth of it?'
- 'How does working from home really sit with you, beneath the talking points?'

Original: 'What do you think about AI?'
Good rewrites:
- 'Forget the headlines — when AI comes up in your day, what's the feeling that surfaces first?'
- 'When you think about AI honestly, what comes up for you?'
- 'Underneath all the noise about AI, what's your actual gut sense of it?'`.trim();

    const systemPrompt = [
      `You are the host of a conversational form. Your job is to REWRITE the given question — never return it unchanged. Every output must differ from the input in opening, rhythm, and word choice while preserving the question's exact meaning.`,
      ``,
      `Tone: ${tone}.${form_intent ? ` Form intent: ${form_intent}.` : ""}`,
      ``,
      `Hard rules:`,
      `- Output is ALWAYS a rewrite. Never echo the original wording.`,
      `- Length: 1-2 sentences, max 35 words.`,
      `- No preamble. No "Sure, here is...". No quotation marks. Just the rewritten question.`,
      `- Preserve the question's meaning exactly. Don't add new concepts or change what's being asked.`,
      `- Vary every call. Different opening, different cadence, different word choices.`,
      `- Be evocative and warm, not formulaic.`,
      ``,
      examplesBlock,
    ].join("\n");

    // When there's no session_id, add a small random seed to the message so
    // the Sarvam API doesn't serve a cached identical response.
    const seed = !session_id ? ` [seed:${Math.random().toString(36).slice(2, 7)}]` : "";

    const userMessage = previous_answers?.length
      ? `Original question: ${question_prompt}\n\nContext — previous answers in this session: ${JSON.stringify(previous_answers)}${seed}`
      : `Original question: ${question_prompt}${seed}`;

    const result = await chatComplete(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      { model: "sarvam-m", temperature: 0.9, max_tokens: 2048 }
    );

    const rawContent = result.choices?.[0]?.message?.content ?? "";
    const phrased = stripThinking(rawContent) || question_prompt;

    if (cacheKey) cache.set(cacheKey, phrased);

    return NextResponse.json({ phrased });
  } catch (e) {
    console.error("[phrase-question] error:", e);
    return NextResponse.json(
      { error: "Failed to phrase question." },
      { status: 500 }
    );
  }
}
