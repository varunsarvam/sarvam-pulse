import { SarvamAIClient } from "sarvamai";

// Required for Buffer and Node.js streams used by the SDK's file upload
export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const audioFile = formData.get("file") as Blob | null;

    if (!audioFile) {
      return Response.json({ error: "No audio file provided." }, { status: 400 });
    }

    const client = new SarvamAIClient({
      apiSubscriptionKey: process.env.SARVAM_API_KEY!,
    });

    // Pass the Blob directly with filename + content-type metadata.
    // AudioWorklet captures 16kHz/16-bit mono PCM wrapped in a RIFF WAV header.
    const result = await client.speechToText.transcribe({
      file: {
        data: audioFile,
        filename: "audio.wav",
        contentType: "audio/wav",
      },
      model: "saarika:v2.5",
      language_code: "en-IN",
    });

    return Response.json({ transcript: result.transcript });
  } catch (e) {
    console.error("[transcribe] error:", e);
    return Response.json({ error: "Transcription failed." }, { status: 500 });
  }
}
