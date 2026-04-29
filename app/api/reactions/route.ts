import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  try {
    const { session_id, question_id, reaction } = (await req.json()) as {
      session_id?: string;
      question_id?: string;
      reaction?: string;
    };

    if (!session_id || !question_id || !reaction) {
      return NextResponse.json(
        { error: "session_id, question_id, and reaction are required." },
        { status: 400 }
      );
    }

    const valid = ["fire", "eyes", "hundred", "thinking"];
    if (!valid.includes(reaction)) {
      return NextResponse.json(
        { error: `reaction must be one of: ${valid.join(", ")}` },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    const { error } = await supabase
      .from("reactions")
      .insert({ session_id, question_id, reaction });

    if (error) {
      console.error("reactions insert error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("reactions route error:", e);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 }
    );
  }
}
