import { NextRequest, NextResponse } from "next/server";
import { chatComplete } from "@/lib/sarvam";

// ─── In-memory cache ──────────────────────────────────────────────────────────
// Keyed by JSON.stringify({ question_prompt, tone, form_intent }).
// previous_answers deliberately excluded from the key — phrasing doesn't
// change based on prior answers, only on the question + form context.

const cache = new Map<string, string>();

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { question_prompt, tone, form_intent, previous_answers } =
      await req.json();

    if (!question_prompt || !tone) {
      return NextResponse.json(
        { error: "question_prompt and tone are required." },
        { status: 400 }
      );
    }

    const cacheKey = JSON.stringify({ question_prompt, tone, form_intent });
    const cached = cache.get(cacheKey);
    if (cached) {
      return NextResponse.json({ phrased: cached });
    }

    const systemPrompt = [
      `You are the host of a conversational form.`,
      `Your job is to rephrase the given question in the ${tone} tone, in 1-2 sentences max.`,
      `Stay faithful to the original meaning.`,
      form_intent
        ? `Match the form's overall intent: ${form_intent}.`
        : "",
      `Do not introduce new topics. Do not ask a different question.`,
      `Just rephrase warmly. Output only the rephrased question, no preamble.`,
    ]
      .filter(Boolean)
      .join(" ");

    const userMessage = previous_answers?.length
      ? `Original question: ${question_prompt}\n\nContext — previous answers in this session: ${JSON.stringify(previous_answers)}`
      : `Original question: ${question_prompt}`;

    const start = Date.now();

    const result = await chatComplete(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      { model: "sarvam-105b", temperature: 0.7, max_tokens: 150 }
    );

    const elapsed = Date.now() - start;
    if (elapsed > 2500) {
      console.warn(
        `[phrase-question] slow response: ${elapsed}ms for prompt "${question_prompt.slice(0, 60)}…"`
      );
    }

    const phrased =
      result.choices?.[0]?.message?.content?.trim() ?? question_prompt;

    cache.set(cacheKey, phrased);

    return NextResponse.json({ phrased });
  } catch (e) {
    console.error("[phrase-question] error:", e);
    // Fall back gracefully — caller can use the original prompt
    return NextResponse.json(
      { error: "Failed to phrase question." },
      { status: 500 }
    );
  }
}
