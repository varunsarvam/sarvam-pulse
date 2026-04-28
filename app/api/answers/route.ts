import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  try {
    const { session_id, question_id, raw_value, transcript } = await req.json();

    if (!session_id || !question_id || raw_value === undefined) {
      return NextResponse.json(
        { error: "session_id, question_id, and raw_value are required." },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    const { error } = await supabase.from("answers").insert({
      session_id,
      question_id,
      raw_value,
      transcript: transcript ?? null,
    });

    if (error) {
      console.error("answers insert error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Phase 6 will compute the reflection and return it here.
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
