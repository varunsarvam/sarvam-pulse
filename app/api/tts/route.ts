import { SarvamAIClient } from "sarvamai";
import { mapToneToVoice } from "@/lib/sarvam";

// Node.js runtime required — SDK uses Node streams internally
export const runtime = "nodejs";

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    const { text, tone = "insightful" } = (await req.json()) as {
      text?: string;
      tone?: string;
    };

    if (!text?.trim()) {
      return Response.json({ error: "text is required." }, { status: 400 });
    }

    const voice = mapToneToVoice(tone);

    const client = new SarvamAIClient({
      apiSubscriptionKey: process.env.SARVAM_API_KEY!,
    });

    // convertStream returns an HTTP streaming BinaryResponse (bulbul:v3 supported).
    // Preferred over the WebSocket API because:
    //   - supports bulbul:v3 (better quality, 30+ voices)
    //   - returns a ReadableStream directly — no WebSocket lifecycle to manage
    //   - works reliably in serverless / long-running Node.js routes
    const ttsResponse = await client.textToSpeech.convertStream({
      text,
      target_language_code: "en-IN",
      speaker: voice as Parameters<typeof client.textToSpeech.convertStream>[0]["speaker"],
      model: "bulbul:v3",
      output_audio_codec: "mp3",
      speech_sample_rate: 24000,
    });

    const audioStream = ttsResponse.stream();

    if (!audioStream) {
      return Response.json({ error: "No audio stream returned." }, { status: 500 });
    }

    return new Response(audioStream, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Transfer-Encoding": "chunked",
        "Cache-Control": "no-cache",
      },
    });
  } catch (e) {
    console.error("[tts] error:", e);
    return Response.json({ error: "TTS failed." }, { status: 500 });
  }
}
