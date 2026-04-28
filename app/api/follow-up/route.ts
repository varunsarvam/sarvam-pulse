import { NextRequest, NextResponse } from "next/server";
import { chatComplete } from "@/lib/sarvam";

function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

export async function POST(req: NextRequest) {
  try {
    const { question_prompt, question_intent, answer_text, tone } =
      await req.json();

    if (!question_prompt || !answer_text || !tone) {
      return NextResponse.json(
        { error: "question_prompt, answer_text, and tone are required." },
        { status: 400 }
      );
    }

    const systemPrompt = [
      `You're a thoughtful host having a conversation.`,
      `Decide if this answer needs ONE follow-up to reach the question's intent: ${question_intent ?? question_prompt}.`,
      `If yes, output a single short follow-up question (max 15 words) in ${tone} tone.`,
      `If no, output exactly the word: SKIP.`,
      `Never ask more than one follow-up. Never introduce new topics.`,
      `Output only the follow-up question OR the word SKIP, no preamble.`,
    ].join(" ");

    const userMessage = `Question asked: ${question_prompt}\nAnswer given: ${answer_text}`;

    const result = await chatComplete(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      { model: "sarvam-m", temperature: 0.6, max_tokens: 2048 }
    );

    const content = stripThinking(result.choices?.[0]?.message?.content ?? "");
    const follow_up = !content || content.toUpperCase() === "SKIP" ? null : content;

    return NextResponse.json({ follow_up });
  } catch (e) {
    console.error("[follow-up] error:", e);
    // Fail gracefully — no follow-up is better than a broken flow
    return NextResponse.json({ follow_up: null });
  }
}
