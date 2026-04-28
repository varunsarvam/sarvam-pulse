import { NextRequest, NextResponse } from "next/server";
import { chatComplete } from "@/lib/sarvam";

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

    const systemPrompt = [
      `You are the host of a conversational form.`,
      `Your job is to rephrase the given question in the ${tone} tone, in 1-2 sentences max.`,
      `Stay faithful to the original meaning.`,
      form_intent ? `Match the form's overall intent: ${form_intent}.` : "",
      `Do not introduce new topics. Do not ask a different question.`,
      `Just rephrase warmly. Output only the rephrased question, no preamble.`,
      `Each time you're called, vary the opening, rhythm, and word choice while preserving the question's meaning.`,
      `Don't repeat phrasings you've produced before. Be evocative, not formulaic.`,
    ]
      .filter(Boolean)
      .join(" ");

    const userMessage = previous_answers?.length
      ? `Original question: ${question_prompt}\n\nContext — previous answers in this session: ${JSON.stringify(previous_answers)}`
      : `Original question: ${question_prompt}`;

    const result = await chatComplete(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      { model: "sarvam-105b", temperature: 0.85, max_tokens: 150 }
    );

    const phrased =
      result.choices?.[0]?.message?.content?.trim() ?? question_prompt;

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
