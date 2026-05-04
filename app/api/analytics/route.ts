import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import type { Question, Session, Answer, InputType } from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Sarvam pulse form id — frozen by user request
const FORM_ID = "3ae8eb7d-5dc8-42f0-8bf7-8a39fb2046bf";

// Fixed launch cutoff — everything before this is junk test data.
// May 1, 2026 00:00 IST = April 30, 2026 18:30 UTC.
const LAUNCH_CUTOFF_ISO = "2026-04-30T18:30:00.000Z";

interface RawAnswerValue {
  type?: string;
  value?: unknown;
}

function getStringValue(raw: unknown): string | null {
  if (raw && typeof raw === "object" && "value" in raw) {
    const v = (raw as RawAnswerValue).value;
    if (typeof v === "string") return v;
    if (typeof v === "number") return String(v);
  }
  return null;
}

function getNumberValue(raw: unknown): number | null {
  if (raw && typeof raw === "object" && "value" in raw) {
    const v = (raw as RawAnswerValue).value;
    if (typeof v === "number") return v;
    if (typeof v === "string" && !isNaN(Number(v))) return Number(v);
  }
  return null;
}

export async function GET() {
  const supabase = createAdminClient();
  const since = LAUNCH_CUTOFF_ISO;

  const [{ data: form }, { data: questions }, { data: sessions }] = await Promise.all([
    supabase.from("forms").select("id,title,tone,intent").eq("id", FORM_ID).single(),
    supabase
      .from("questions")
      .select("id,position,prompt,intent,input_type,options")
      .eq("form_id", FORM_ID)
      .order("position", { ascending: true }),
    supabase
      .from("sessions")
      .select(
        "id,respondent_name,started_at,completed_at,identity_label,identity_summary"
      )
      .eq("form_id", FORM_ID)
      .eq("is_seed", false)
      .gte("started_at", since)
      .order("started_at", { ascending: true }),
  ]);

  const sessionList = (sessions ?? []) as Session[];
  const sessionIds = sessionList.map((s) => s.id);

  let answersList: Answer[] = [];
  if (sessionIds.length) {
    const { data: answers } = await supabase
      .from("answers")
      .select("id,session_id,question_id,raw_value,transcript,sentiment,created_at")
      .in("session_id", sessionIds)
      .order("created_at", { ascending: true });
    answersList = (answers ?? []) as Answer[];
  }

  const questionsList = (questions ?? []) as Question[];
  const qById = new Map(questionsList.map((q) => [q.id, q]));

  // Per-question answer-count + raw answers
  const perQuestion = questionsList.map((q) => {
    const qAnswers = answersList.filter((a) => a.question_id === q.id);
    return {
      id: q.id,
      position: q.position,
      prompt: q.prompt,
      input_type: q.input_type as InputType,
      answered: qAnswers.length,
      uniqueRespondents: new Set(qAnswers.map((a) => a.session_id)).size,
    };
  });

  // Hero metrics
  const totalOpened = sessionList.length;
  const gotPastName = new Set(
    answersList
      .filter((a) => qById.get(a.question_id)?.input_type === "name")
      .map((a) => a.session_id)
  ).size;
  const completed = sessionList.filter((s) => s.completed_at).length;
  const completionRate = totalOpened ? Math.round((completed / totalOpened) * 100) : 0;

  // Funnel
  const funnel = [
    { stage: "Opened the form", count: totalOpened, isStart: true },
    { stage: "Got past name", count: gotPastName },
    ...questionsList
      .filter((q) => q.input_type !== "name")
      .map((q) => ({
        stage: q.prompt,
        count: perQuestion.find((pq) => pq.id === q.id)?.uniqueRespondents ?? 0,
        position: q.position,
      })),
  ];

  // Energy slider (emoji_slider) distribution + average
  const sliderQ = questionsList.find((q) => q.input_type === "emoji_slider");
  const sliderValues = sliderQ
    ? answersList
        .filter((a) => a.question_id === sliderQ.id)
        .map((a) => getNumberValue(a.raw_value))
        .filter((v): v is number => v !== null)
    : [];
  const sliderAvg = sliderValues.length
    ? Math.round(sliderValues.reduce((s, v) => s + v, 0) / sliderValues.length)
    : null;
  // 5-bucket histogram (0-20, 20-40, 40-60, 60-80, 80-100)
  const sliderBuckets = [0, 0, 0, 0, 0];
  for (const v of sliderValues) {
    const idx = Math.min(4, Math.floor(v / 20));
    sliderBuckets[idx] += 1;
  }

  // Cards (excitement) distribution
  const cardsQ = questionsList.find((q) => q.input_type === "cards");
  const cardCounts = new Map<string, number>();
  if (cardsQ) {
    for (const a of answersList.filter((a) => a.question_id === cardsQ.id)) {
      const v = getStringValue(a.raw_value);
      if (v) cardCounts.set(v, (cardCounts.get(v) ?? 0) + 1);
    }
  }
  const cardsDistribution = Array.from(cardCounts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);

  // Identity distribution (only on completed sessions)
  const identityCounts = new Map<string, number>();
  for (const s of sessionList) {
    if (s.identity_label) {
      identityCounts.set(s.identity_label, (identityCounts.get(s.identity_label) ?? 0) + 1);
    }
  }
  const identities = Array.from(identityCounts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);

  // Live feed — latest open-ended answers (voice + text), most recent first
  const openEndedTypes: InputType[] = ["voice", "text"];
  const liveFeed = answersList
    .filter((a) => {
      const q = qById.get(a.question_id);
      return q && openEndedTypes.includes(q.input_type);
    })
    .map((a) => {
      const q = qById.get(a.question_id)!;
      const session = sessionList.find((s) => s.id === a.session_id);
      const text = a.transcript || getStringValue(a.raw_value);
      return {
        text: text ?? "",
        prompt: q.prompt,
        position: q.position,
        respondent: session?.respondent_name || "Anonymous",
        created_at: a.created_at,
      };
    })
    .filter((e) => e.text.trim().length > 0)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 30);

  // Respondent rows — one per session, with answer count & status
  const respondents = sessionList
    .map((s) => {
      const sessionAnswers = answersList.filter((a) => a.session_id === s.id);
      const nonNameCount = sessionAnswers.filter(
        (a) => qById.get(a.question_id)?.input_type !== "name"
      ).length;
      const totalQuestions = questionsList.filter((q) => q.input_type !== "name").length;
      return {
        id: s.id,
        name: s.respondent_name || null,
        started_at: s.started_at,
        completed_at: s.completed_at,
        identity_label: s.identity_label,
        identity_summary: s.identity_summary,
        answered: nonNameCount,
        total: totalQuestions,
      };
    })
    .sort((a, b) => b.started_at.localeCompare(a.started_at));

  return NextResponse.json({
    form: {
      id: form?.id ?? FORM_ID,
      title: form?.title ?? "Sarvam pulse",
    },
    since,
    generated_at: new Date().toISOString(),
    hero: {
      totalOpened,
      gotPastName,
      completed,
      completionRate,
    },
    funnel,
    perQuestion,
    slider: sliderQ
      ? {
          prompt: sliderQ.prompt,
          average: sliderAvg,
          buckets: sliderBuckets,
          count: sliderValues.length,
        }
      : null,
    cards: cardsQ
      ? {
          prompt: cardsQ.prompt,
          distribution: cardsDistribution,
          count: Array.from(cardCounts.values()).reduce((s, n) => s + n, 0),
        }
      : null,
    identities,
    liveFeed,
    respondents,
  });
}
