import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

function normalizeName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return null;
  if (trimmed.length > 30) return null;
  if (!/^[A-Za-z][A-Za-z\s'-]{0,29}$/.test(trimmed)) return null;
  return trimmed;
}

export async function POST(req: NextRequest) {
  try {
    const { form_id, respondent_name } = await req.json();

    if (!form_id) {
      return NextResponse.json(
        { error: "form_id is required." },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();
    const name = normalizeName(respondent_name);

    const { data: session, error } = await supabase
      .from("sessions")
      .insert({ form_id, respondent_name: name })
      .select("id, respondent_name")
      .single();

    if (error || !session) {
      console.error("sessions insert error:", error);
      return NextResponse.json(
        { error: error?.message ?? "Failed to create session." },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { id: session.id, respondent_name: session.respondent_name },
      { status: 201 }
    );
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { session_id, respondent_name } = await req.json();
    if (!session_id) {
      return NextResponse.json(
        { error: "session_id is required." },
        { status: 400 }
      );
    }

    const name = normalizeName(respondent_name);
    if (respondent_name && !name) {
      return NextResponse.json(
        { error: "Name must be 1-30 letters, spaces, apostrophes, or hyphens." },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("sessions")
      .update({ respondent_name: name })
      .eq("id", session_id)
      .select("id, respondent_name")
      .single();

    if (error || !data) {
      console.error("sessions update error:", error);
      return NextResponse.json(
        { error: error?.message ?? "Failed to update session." },
        { status: 500 }
      );
    }

    return NextResponse.json(data);
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 }
    );
  }
}
