import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  try {
    const { form_id } = await req.json();

    if (!form_id) {
      return NextResponse.json(
        { error: "form_id is required." },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    const { data: session, error } = await supabase
      .from("sessions")
      .insert({ form_id })
      .select("id")
      .single();

    if (error || !session) {
      console.error("sessions insert error:", error);
      return NextResponse.json(
        { error: error?.message ?? "Failed to create session." },
        { status: 500 }
      );
    }

    return NextResponse.json({ id: session.id }, { status: 201 });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 }
    );
  }
}
