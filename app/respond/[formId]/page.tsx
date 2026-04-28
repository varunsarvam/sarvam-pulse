import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { RespondentFlow } from "./RespondentFlow";
import type { Form, Question } from "@/lib/types";

export default async function RespondPage({
  params,
}: {
  params: Promise<{ formId: string }>;
}) {
  const { formId } = await params;
  const supabase = createAdminClient();

  const { data: form } = await supabase
    .from("forms")
    .select("*")
    .eq("id", formId)
    .single();

  if (!form) notFound();

  const { data: questions } = await supabase
    .from("questions")
    .select("*")
    .eq("form_id", formId)
    .order("position");

  return (
    <RespondentFlow
      form={form as Form}
      questions={(questions ?? []) as Question[]}
    />
  );
}
