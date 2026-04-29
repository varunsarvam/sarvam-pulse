import { NextRequest, NextResponse } from "next/server";
import { chatCompleteStream } from "@/lib/sarvam";

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Strip model reasoning wrappers from the final accumulated text.
// Returns "" if the <think> block was truncated (never closed), so the caller
// can fall back to the original question rather than showing raw thinking text.
function stripThinking(text: string): string {
  // If there's an unclosed <think> block, the model hit token limit mid-think
  if (/<think>/i.test(text) && !/<\/think>/i.test(text)) return "";

  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<\/?answer>/gi, "")
    .trim();
}

// ─── In-memory cache ──────────────────────────────────────────────────────────
// Keyed by { session_id, question_prompt, tone, form_intent }.
// Same session → instant JSON (cache hit). Different sessions → fresh stream.
// No session_id → one-off, no caching.

const cache = new Map<string, string>();

// ─── SSE helpers ──────────────────────────────────────────────────────────────

const enc = new TextEncoder();

function sseEvent(data: object): Uint8Array {
  return enc.encode(`data: ${JSON.stringify(data)}\n\n`);
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const requestStart = Date.now();
  let question_prompt = "";

  try {
    console.time("phrase-total");
    const body = await req.json();
    const { tone, form_intent, previous_answers, session_id } = body;
    question_prompt = body.question_prompt ?? "";

    if (!question_prompt || !tone) {
      console.timeEnd("phrase-total");
      return NextResponse.json(
        { error: "question_prompt and tone are required." },
        { status: 400 }
      );
    }

    const cacheKey = session_id
      ? JSON.stringify({ session_id, question_prompt, tone, form_intent })
      : null;

    // ── Cache hit → instant JSON (no streaming overhead) ──
    if (cacheKey) {
      const cached = cache.get(cacheKey);
      if (cached) {
        console.timeEnd("phrase-total");
        return NextResponse.json({ phrased: cached });
      }
    }

    // ── Build prompt ──────────────────────────────────────
    console.time("phrase-prompt-build");
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

    const seed = !session_id
      ? ` [seed:${Math.random().toString(36).slice(2, 7)}]`
      : "";

    const userMessage =
      previous_answers?.length
        ? `Original question: ${question_prompt}\n\nContext — previous answers in this session: ${JSON.stringify(previous_answers)}${seed}`
        : `Original question: ${question_prompt}${seed}`;

    const messages = [
      { role: "system" as const, content: systemPrompt },
      { role: "user" as const, content: userMessage },
    ];
    console.timeEnd("phrase-prompt-build");
    console.log(
      `[phrase-question] system_prompt_chars=${systemPrompt.length} estimated_tokens=${Math.ceil(systemPrompt.length / 4)}`
    );

    // ── SSE streaming response ────────────────────────────
    // sarvam-30b sends reasoning in delta.reasoning_content and the answer in
    // delta.content. chatCompleteStream yields only delta.content, so chunks
    // naturally arrive only once reasoning finishes. reasoning_effort:'low'
    // keeps the thinking phase as short as possible.
    const stream = new ReadableStream({
      async start(controller) {
        let accumulated = "";
        let sawFirstChunk = false;

        try {
          console.time("phrase-llm-firstchunk");
          for await (const chunk of chatCompleteStream(messages, {
            model: "sarvam-30b",
            temperature: 0.9,
            max_tokens: 150,
            top_p: 1,
            extra_body: {
              chat_template_kwargs: {
                enable_thinking: false,
              },
            },
          })) {
            // Skip empty or whitespace-only leading chunks (sarvam-30b emits
            // a bare "\n" as its first content token)
            if (!chunk || (!accumulated && !chunk.trim())) continue;
            if (!sawFirstChunk) {
              sawFirstChunk = true;
              console.timeEnd("phrase-llm-firstchunk");
              console.time("phrase-llm-complete");
              console.log(
                `[phrase-question] request_to_first_chunk_ms=${Date.now() - requestStart}`
              );
            }
            accumulated += chunk;
            controller.enqueue(sseEvent({ chunk }));
          }

          if (!sawFirstChunk) {
            console.timeEnd("phrase-llm-firstchunk");
            console.time("phrase-llm-complete");
          }
          console.timeEnd("phrase-llm-complete");
          // Strip any wrapper tags that slipped through, then cache
          const phrased = stripThinking(accumulated) || question_prompt;
          controller.enqueue(sseEvent({ done: true, phrased }));
          if (cacheKey) cache.set(cacheKey, phrased);
        } catch (e) {
          if (!sawFirstChunk) {
            console.timeEnd("phrase-llm-firstchunk");
          } else {
            console.timeEnd("phrase-llm-complete");
          }
          console.error("[phrase-question stream]:", e);
          controller.enqueue(
            sseEvent({ error: true, fallback: question_prompt })
          );
        } finally {
          controller.close();
          console.timeEnd("phrase-total");
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (e) {
    console.error("[phrase-question] error:", e);
    console.timeEnd("phrase-total");
    return NextResponse.json(
      { error: "Failed to phrase question." },
      { status: 500 }
    );
  }
}
