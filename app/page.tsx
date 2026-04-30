import Link from "next/link";
import { FormCard } from "@/components/FormCard";
import { NewFormCard } from "@/components/NewFormCard";
import { createAdminClient } from "@/lib/supabase/server";
import type { Form } from "@/lib/types";

interface SessionCountRow {
  form_id: string;
  completed_at: string | null;
}

async function getFormsDashboardData() {
  const supabase = createAdminClient();

  const [{ data: forms }, { data: sessions }] = await Promise.all([
    supabase
      .from("forms")
      .select("*")
      .order("created_at", { ascending: false }),
    supabase.from("sessions").select("form_id, completed_at"),
  ]);

  const counts = new Map<
    string,
    { responseCount: number; completedCount: number }
  >();

  for (const session of (sessions ?? []) as SessionCountRow[]) {
    const current = counts.get(session.form_id) ?? {
      responseCount: 0,
      completedCount: 0,
    };
    current.responseCount += 1;
    if (session.completed_at) current.completedCount += 1;
    counts.set(session.form_id, current);
  }

  return {
    forms: (forms ?? []) as Form[],
    counts,
  };
}

export default async function Home() {
  const { forms, counts } = await getFormsDashboardData();

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-10 md:px-10 md:py-14">
        <header>
          <p className="text-xs font-medium tracking-[0.24em] uppercase text-muted-foreground">
            Pulse
          </p>
          <h1 className="mt-1 text-4xl font-bold tracking-tight">
            Conversational forms
          </h1>
        </header>

        <section className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {forms.map((form, index) => {
            const count = counts.get(form.id) ?? {
              responseCount: 0,
              completedCount: 0,
            };
            return (
              <FormCard
                key={form.id}
                form={form}
                responseCount={count.responseCount}
                completedCount={count.completedCount}
                index={index}
              />
            );
          })}

          {/* New form card — always last */}
          <NewFormCard index={forms.length} />
        </section>
      </div>
    </main>
  );
}
