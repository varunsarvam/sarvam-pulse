"use server";

import { createAdminClient } from "@/lib/supabase/server";

export async function updateFormAppearance(formId: string, appearance: string): Promise<void> {
  const supabase = createAdminClient();
  await supabase.from("forms").update({ appearance }).eq("id", formId);
}
