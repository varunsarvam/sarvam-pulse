import Link from "next/link";
import { FormCard } from "@/components/FormCard";
import { NewFormCard } from "@/components/NewFormCard";
import { createAdminClient } from "@/lib/supabase/server";
import type { Form } from "@/lib/types";

// Render at request time, not build time — avoids hitting Supabase during
// `next build`, which fails on Vercel if env vars aren't injected during the
// build phase.
export const dynamic = "force-dynamic";

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
    <main className="flex min-h-screen flex-col items-center justify-between bg-background px-6 py-8 md:px-10 md:py-10">

      {/* Top asset — ornamental logo mark */}
      <div className="flex w-full justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/main-top-asset.png"
          alt="Pulse"
          className="h-12 w-auto opacity-80 -mt-4"
          draggable={false}
        />
      </div>

      {/* Cards — vertically + horizontally centered */}
      <section className="flex flex-nowrap justify-center gap-4 [&>*]:w-[180px] [&>*]:shrink-0">
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
        <NewFormCard index={forms.length} />
      </section>

      {/* Bottom asset — "INTELLIGENT FORMS" wordmark */}
      <div className="flex w-full justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/main-bottom-asset.png"
          alt="Intelligent Forms"
          className="h-7 w-auto opacity-60"
          draggable={false}
        />
      </div>

    </main>
  );
}
