const SARVAM_API_KEY = process.env.SARVAM_API_KEY!;

// ─── Tone → TTS voice mapping ─────────────────────────────────────────────────

const TONE_VOICE: Record<string, string> = {
  insightful: "varun",
  playful: "anushka",
  calm: "neha",
  direct: "advait",
};

export function mapToneToVoice(tone: string): string {
  return TONE_VOICE[tone] ?? "varun";
}

// ─── Speech to Text ───────────────────────────────────────────────────────────

export interface TranscribeResult {
  transcript: string;
  language_code?: string;
}

export async function transcribeAudio(
  audioBlob: Blob
): Promise<TranscribeResult> {
  const formData = new FormData();
  formData.append("file", audioBlob, "audio.webm");
  formData.append("model", "saarika:v2.5");
  formData.append("language_code", "en-IN");

  const res = await fetch("https://api.sarvam.ai/speech-to-text", {
    method: "POST",
    headers: {
      "api-subscription-key": SARVAM_API_KEY,
    },
    body: formData,
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Sarvam STT error ${res.status}: ${error}`);
  }

  return res.json();
}

// ─── Text to Speech ───────────────────────────────────────────────────────────
// TTS is handled by the official `sarvamai` SDK in `app/api/tts/route.ts`
// (streamed mp3 response). No standalone helper here.

// ─── Chat Completions ─────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  reasoning_effort?: "low" | "medium" | "high" | null;
  extra_body?: Record<string, unknown>;
  stream?: boolean;
}

export interface ChatResult {
  id: string;
  choices: {
    message: ChatMessage;
    finish_reason: string;
    index: number;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export async function chatComplete(
  messages: ChatMessage[],
  options: ChatOptions = {}
): Promise<ChatResult> {
  const { model = "sarvam-105b", reasoning_effort, ...rest } = options;

  const body: Record<string, unknown> = {
    model,
    messages,
    ...rest,
  };

  if (reasoning_effort !== undefined) {
    body.reasoning_effort = reasoning_effort;
  }

  const res = await fetch("https://api.sarvam.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-subscription-key": SARVAM_API_KEY,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Sarvam chat error ${res.status}: ${error}`);
  }

  return res.json();
}

// ─── Streaming Chat Completions ───────────────────────────────────────────────

export interface StreamChatOptions {
  model?: string;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  reasoning_effort?: "low" | "medium" | "high" | null;
  extra_body?: Record<string, unknown>;
}

export async function* chatCompleteStream(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  options: StreamChatOptions = {}
): AsyncGenerator<string, void, unknown> {
  const { reasoning_effort, ...rest } = options;

  const body: Record<string, unknown> = {
    model: rest.model ?? "sarvam-105b",
    messages,
    temperature: rest.temperature ?? 0.7,
    max_tokens: rest.max_tokens ?? 200,
    top_p: rest.top_p ?? 1,
    ...(rest.extra_body !== undefined ? { extra_body: rest.extra_body } : {}),
    stream: true,
  };

  if (reasoning_effort !== undefined) {
    body.reasoning_effort = reasoning_effort;
  }

  const res = await fetch("https://api.sarvam.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "api-subscription-key": SARVAM_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok || !res.body) {
    throw new Error(`Sarvam stream failed: ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") return;

      try {
        const chunk = JSON.parse(data);
        const content = chunk.choices?.[0]?.delta?.content;
        if (content) yield content;
      } catch {
        // skip malformed chunks
      }
    }
  }
}
