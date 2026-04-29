import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { ShareCard } from "@/components/ShareCard";
import { Button } from "@/components/ui/button";
import type { FormTone } from "@/lib/types";

interface SharePageProps {
  params: Promise<{ sessionId: string }>;
}

interface SessionRow {
  id: string;
  form_id: string;
  respondent_name: string | null;
  identity_label: string | null;
  identity_summary: string | null;
  forms: {
    id: string;
    title: string;
    tone: FormTone;
  } | null;
}

async function fetchSession(sessionId: string): Promise<SessionRow | null> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("sessions")
    .select(
      `
      id,
      form_id,
      respondent_name,
      identity_label,
      identity_summary,
      forms ( id, title, tone )
    `
    )
    .eq("id", sessionId)
    .maybeSingle();

  return (data as unknown as SessionRow) ?? null;
}

// ─── Dynamic metadata for OpenGraph ────────────────────────────────────────────

export async function generateMetadata({
  params,
}: SharePageProps): Promise<Metadata> {
  const { sessionId } = await params;
  const session = await fetchSession(sessionId);

  if (!session?.identity_label) {
    return {
      title: "Pulse — Voice-first forms",
      description: "A live, social conversational form experience.",
    };
  }

  const title = session.respondent_name
    ? `${session.respondent_name} is a ${session.identity_label}`
    : `I'm a ${session.identity_label}`;
  const description =
    session.identity_summary?.split(/(?<=[.!?])\s+/)[0] ??
    "Discover your identity through Pulse — a voice-first conversational form.";

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      siteName: "Pulse",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default async function SharePage({ params }: SharePageProps) {
  const { sessionId } = await params;
  const session = await fetchSession(sessionId);

  if (!session || !session.forms) notFound();
  if (!session.identity_label || !session.identity_summary) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6 bg-background">
        <div className="flex flex-col items-center gap-4 max-w-md text-center">
          <p className="text-sm font-medium tracking-widest uppercase text-muted-foreground">
            Not yet
          </p>
          <h1 className="text-2xl font-semibold">
            This response is still being processed
          </h1>
          <p className="text-sm text-muted-foreground">
            Identity hasn&apos;t been generated yet. Try refreshing in a moment.
          </p>
          <Link href={`/respond/${session.form_id}`}>
            <Button variant="outline">Try the form yourself →</Button>
          </Link>
        </div>
      </main>
    );
  }

  const tone = session.forms.tone;
  const identity = {
    label: session.identity_label,
    summary: session.identity_summary,
  };
  const respondentName = session.respondent_name;

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 py-12 bg-gradient-to-b from-background via-background to-muted/20">
      <div className="flex flex-col items-center gap-8 max-w-md w-full">
        <p className="text-xs font-medium tracking-[0.2em] uppercase text-muted-foreground">
          Someone shared their identity
        </p>

        <ShareCard
          identity={identity}
          tone={tone}
          respondentName={respondentName}
        />

        <div className="flex flex-col items-center gap-3 text-center">
          <p className="text-sm text-muted-foreground max-w-sm leading-relaxed">
            {respondentName
              ? `${respondentName} took “${session.forms.title}” on Pulse. Curious what it would say about you?`
              : `They took “${session.forms.title}” on Pulse — a voice-first conversational form. Curious what it would say about you?`}
          </p>
          <Link href={`/respond/${session.form_id}`}>
            <Button size="lg" className="text-base px-8">
              Try it yourself →
            </Button>
          </Link>
        </div>

        <p className="text-[10px] font-mono text-muted-foreground/50 mt-2">
          pulse.app
        </p>
      </div>
    </main>
  );
}
