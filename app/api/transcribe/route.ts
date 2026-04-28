import { NextResponse } from "next/server";

// Phase 5 will wire up Sarvam STT here.
// For now, return a placeholder so the VoiceInput review flow can be exercised.
export async function POST() {
  return NextResponse.json({
    transcript: "Voice transcript would appear here",
  });
}
