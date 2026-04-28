import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import type { InputType, FormTone } from "@/lib/types";

interface QuestionPayload {
  position: number;
  prompt: string;
  intent: string | null;
  input_type: InputType;
  options: unknown | null;
  follow_up_enabled: boolean;
  required: boolean;
}

interface CreateFormPayload {
  title: string;
  intent: string | null;
  tone: FormTone;
  questions: QuestionPayload[];
}

export async function POST(req: NextRequest) {
  try {
    const body: CreateFormPayload = await req.json();
    const { title, intent, tone, questions } = body;

    if (!title?.trim()) {
      return NextResponse.json({ error: "Title is required." }, { status: 400 });
    }

    const supabase = createAdminClient();

    const { data: form, error: formError } = await supabase
      .from("forms")
      .insert({ title: title.trim(), intent, tone, status: "published" })
      .select("id")
      .single();

    if (formError || !form) {
      console.error("forms insert error:", formError);
      return NextResponse.json(
        { error: formError?.message ?? "Failed to create form." },
        { status: 500 }
      );
    }

    if (questions?.length > 0) {
      const rows = questions.map((q) => ({
        form_id: form.id,
        position: q.position,
        prompt: q.prompt,
        intent: q.intent,
        input_type: q.input_type,
        options: q.options,
        follow_up_enabled: q.follow_up_enabled,
        required: q.required,
      }));

      const { error: qError } = await supabase.from("questions").insert(rows);

      if (qError) {
        console.error("questions insert error:", qError);
        return NextResponse.json(
          { error: qError.message },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ id: form.id }, { status: 201 });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
