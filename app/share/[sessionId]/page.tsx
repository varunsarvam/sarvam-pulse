import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { ShareCard } from "@/components/ShareCard";
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
    .select("id, form_id, respondent_name, identity_label, identity_summary, forms ( id, title, tone )")
    .eq("id", sessionId)
    .maybeSingle();
  return (data as unknown as SessionRow) ?? null;
}

export async function generateMetadata({ params }: SharePageProps): Promise<Metadata> {
  const { sessionId } = await params;
  const session = await fetchSession(sessionId);

  if (!session?.identity_label) {
    return { title: "Pulse — Voice-first forms", description: "A live, social conversational form experience." };
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
    openGraph: { title, description, type: "website", siteName: "Pulse" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function SharePage({ params }: SharePageProps) {
  const { sessionId } = await params;
  const session = await fetchSession(sessionId);

  if (!session || !session.forms || !session.identity_label) notFound();

  return (
    <ShareCard
      sessionId={sessionId}
      identityLabel={session.identity_label}
      identitySummary={session.identity_summary ?? ""}
      respondentName={session.respondent_name}
      formId={session.forms.id}
      formTitle={session.forms.title}
      formTone={session.forms.tone}
    />
  );
}
