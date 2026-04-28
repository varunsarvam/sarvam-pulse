const SARVAM_API_KEY = process.env.SARVAM_API_KEY!;

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

export interface TTSOptions {
  voice?: string;
  target_language_code?: string;
}

export interface TTSResult {
  audios: string[];
}

export async function textToSpeech(
  text: string,
  voice = "anushka",
  options: TTSOptions = {}
): Promise<TTSResult> {
  const res = await fetch("https://api.sarvam.ai/text-to-speech", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-subscription-key": SARVAM_API_KEY,
    },
    body: JSON.stringify({
      inputs: [text],
      target_language_code: options.target_language_code ?? "en-IN",
      speaker: voice,
      model: "bulbul:v3",
    }),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Sarvam TTS error ${res.status}: ${error}`);
  }

  return res.json();
}

// ─── Chat Completions ─────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  max_tokens?: number;
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
  const { model = "sarvam-105b", ...rest } = options;

  const res = await fetch("https://api.sarvam.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SARVAM_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages,
      ...rest,
    }),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Sarvam chat error ${res.status}: ${error}`);
  }

  return res.json();
}
