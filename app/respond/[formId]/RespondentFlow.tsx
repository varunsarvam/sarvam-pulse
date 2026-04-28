"use client";

import { useState, useEffect } from "react";
import { AnimatePresence, motion, type Variants } from "framer-motion";
import { AIPresence } from "@/components/AIPresence";
import { useLiveData } from "@/hooks/useLiveData";
import { Button } from "@/components/ui/button";
import { VoiceInput } from "@/components/inputs/VoiceInput";
import { TextInput } from "@/components/inputs/TextInput";
import { EmojiSlider } from "@/components/inputs/EmojiSlider";
import { Cards } from "@/components/inputs/Cards";
import { Ranking } from "@/components/inputs/Ranking";
import { ThisOrThat } from "@/components/inputs/ThisOrThat";
import { VisualSelect } from "@/components/inputs/VisualSelect";
import type { Form, Question } from "@/lib/types";

// ─── Option parsers ───────────────────────────────────────────────────────────

function parseStringOptions(opts: unknown): string[] {
  if (!Array.isArray(opts)) return [];
  return opts.filter((o): o is string => typeof o === "string");
}

function parseVisualOptions(
  opts: unknown
): { label: string; image_url: string }[] {
  if (!Array.isArray(opts)) return [];
  return opts.filter(
    (o): o is { label: string; image_url: string } =>
      typeof o === "object" &&
      o !== null &&
      typeof (o as Record<string, unknown>).label === "string" &&
      typeof (o as Record<string, unknown>).image_url === "string"
  );
}

// ─── Stage types ──────────────────────────────────────────────────────────────

type Stage = "ENTRY" | "QUESTION" | "REFLECTION" | "COMPLETE";

// ─── Motion variants ──────────────────────────────────────────────────────────

const fadeUp: Variants = {
  initial: { opacity: 0, y: 24 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.45, ease: "easeOut" as const } },
  exit: { opacity: 0, y: -16, transition: { duration: 0.3, ease: "easeIn" as const } },
};

// ─── Tone-tinted left column gradient ────────────────────────────────────────

const TONE_BG: Record<string, string> = {
  playful:
    "radial-gradient(ellipse at 50% 52%, rgba(249,115,22,0.13) 0%, transparent 68%), #0a0a0a",
  calm:
    "radial-gradient(ellipse at 50% 52%, rgba(59,130,246,0.13) 0%, transparent 68%), #0a0a0a",
  direct:
    "radial-gradient(ellipse at 50% 52%, rgba(156,163,175,0.13) 0%, transparent 68%), #0a0a0a",
  insightful:
    "radial-gradient(ellipse at 50% 52%, rgba(139,92,246,0.13) 0%, transparent 68%), #0a0a0a",
};

// ─── Entry screen ─────────────────────────────────────────────────────────────

function EntryScreen({
  form,
  questions,
  onStart,
}: {
  form: Form;
  questions: Question[];
  onStart: () => Promise<void>;
}) {
  const questionIds = questions.map((q) => q.id);
  const { count, quotes } = useLiveData(form.id, questionIds);
  const [quoteIndex, setQuoteIndex] = useState(0);
  const [starting, setStarting] = useState(false);

  // Cycle quote index every 4s
  useState(() => {
    if (typeof window === "undefined") return;
    const id = setInterval(
      () => setQuoteIndex((i) => (quotes.length > 0 ? (i + 1) % quotes.length : 0)),
      4000
    );
    return () => clearInterval(id);
  });

  const currentQuote = quotes[quoteIndex] ?? null;

  async function handleStart() {
    setStarting(true);
    await onStart().catch(() => setStarting(false));
  }

  return (
    <div className="flex flex-col gap-7 px-12 py-16 max-w-lg w-full">
      {/* Live badge */}
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-400 ring-1 ring-emerald-500/20">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          {count > 0 ? `${count} here now` : "Live"}
        </span>
        <span className="text-xs text-muted-foreground">· ~3 min</span>
      </div>

      {/* Title */}
      <div className="space-y-2">
        <h1 className="text-4xl font-bold tracking-tight leading-tight">
          {form.title}
        </h1>
        {form.intent && (
          <p className="text-base text-muted-foreground">{form.intent}</p>
        )}
      </div>

      {/* Floating quote */}
      <div className="min-h-[72px] flex items-start">
        <AnimatePresence mode="wait">
          {currentQuote ? (
            <motion.blockquote
              key={quoteIndex}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              className="border-l-2 border-border pl-4 text-sm text-muted-foreground italic leading-relaxed"
            >
              "{currentQuote}"
            </motion.blockquote>
          ) : (
            <motion.p
              key="placeholder"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-sm text-muted-foreground/50 italic"
            >
              Be among the first to respond.
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      {/* CTA */}
      <Button
        size="lg"
        className="w-fit text-base px-8"
        onClick={handleStart}
        disabled={starting}
      >
        {starting ? "Starting…" : "Let's start →"}
      </Button>

      {/* Question count */}
      <p className="text-xs text-muted-foreground">
        {questions.length} question{questions.length !== 1 ? "s" : ""}
      </p>
    </div>
  );
}

// ─── Thinking dots ────────────────────────────────────────────────────────────

function ThinkingDots() {
  return (
    <div className="flex items-center gap-1.5 h-8">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="h-2 w-2 rounded-full bg-muted-foreground/50"
          animate={{ opacity: [0.3, 1, 0.3], y: [0, -4, 0] }}
          transition={{
            duration: 0.9,
            repeat: Infinity,
            delay: i * 0.18,
            ease: "easeInOut" as const,
          }}
        />
      ))}
    </div>
  );
}

// ─── Question stage ───────────────────────────────────────────────────────────

function QuestionStage({
  question,
  index,
  total,
  sessionId,
  tone,
  formIntent,
  onAnswer,
}: {
  question: Question;
  index: number;
  total: number;
  sessionId: string | null;
  tone: string;
  formIntent: string | null;
  onAnswer: (rawValue: unknown, transcript?: string) => void;
}) {
  const { input_type, options } = question;
  const [phrased, setPhrased] = useState<string | null>(null);
  const [thinking, setThinking] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    setPhrased(null);
    setThinking(true);

    fetch("/api/phrase-question", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question_prompt: question.prompt,
        tone,
        form_intent: formIntent,
        session_id: sessionId,
      }),
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then(({ phrased: p }: { phrased: string }) => {
        if (!cancelled) setPhrased(p);
      })
      .catch(() => {
        if (!cancelled) setPhrased(question.prompt);
      })
      .finally(() => {
        clearTimeout(timeout);
        if (!cancelled) setThinking(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timeout);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question.id]);

  function handleVoice(v: { type: "voice"; value: string; audioBlob: Blob }) {
    onAnswer({ type: "voice", value: v.value }, v.value);
  }
  function handleText(v: { type: "text"; value: string }) {
    onAnswer(v);
  }
  function handleSlider(v: { type: "emoji_slider"; value: number }) {
    onAnswer(v);
  }
  function handleCards(v: { type: "cards"; value: string }) {
    onAnswer(v);
  }
  function handleRanking(v: { type: "ranking"; value: string[] }) {
    onAnswer(v);
  }
  function handleThisOrThat(v: { type: "this_or_that"; value: string }) {
    onAnswer(v);
  }
  function handleVisual(v: { type: "visual_select"; value: string }) {
    onAnswer(v);
  }

  return (
    <div className="flex flex-col gap-6 px-12 py-14 max-w-lg w-full">
      {/* Progress */}
      <p className="text-xs font-medium tracking-widest uppercase text-muted-foreground">
        {index + 1} / {total}
      </p>

      {/* Prompt — thinking dots until phrasing resolves */}
      <AnimatePresence mode="wait">
        {thinking ? (
          <motion.div
            key="thinking"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <ThinkingDots />
          </motion.div>
        ) : (
          <motion.h2
            key="prompt"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: "easeOut" as const }}
            className="text-2xl font-medium leading-snug"
          >
            {phrased ?? question.prompt}
          </motion.h2>
        )}
      </AnimatePresence>

      {/* Input */}
      {input_type === "voice" && (
        <VoiceInput question={question} onSubmit={handleVoice} />
      )}
      {input_type === "text" && (
        <TextInput question={question} onSubmit={handleText} />
      )}
      {input_type === "emoji_slider" && (
        <EmojiSlider question={question} onSubmit={handleSlider} />
      )}
      {input_type === "cards" && (
        <Cards
          question={question}
          options={parseStringOptions(options)}
          onSubmit={handleCards}
        />
      )}
      {input_type === "ranking" && (
        <Ranking
          question={question}
          options={parseStringOptions(options)}
          onSubmit={handleRanking}
        />
      )}
      {input_type === "this_or_that" && (
        <ThisOrThat
          question={question}
          options={parseStringOptions(options)}
          onSubmit={handleThisOrThat}
        />
      )}
      {input_type === "visual_select" && (
        <VisualSelect
          question={question}
          options={parseVisualOptions(options)}
          onSubmit={handleVisual}
        />
      )}
    </div>
  );
}

function ReflectionStage() {
  return (
    <div className="flex flex-col gap-6 px-12 py-16 max-w-lg w-full">
      <p className="text-xs font-medium tracking-widest uppercase text-muted-foreground">
        Reflection
      </p>
      <div className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground text-sm">
        Social reflection — coming in next phase
      </div>
    </div>
  );
}

function CompleteStage({ form }: { form: Form }) {
  return (
    <div className="flex flex-col gap-6 px-12 py-16 max-w-lg w-full text-center items-center">
      <p className="text-xs font-medium tracking-widest uppercase text-muted-foreground">
        Complete
      </p>
      <h2 className="text-2xl font-semibold">Thanks for completing "{form.title}"</h2>
      <div className="rounded-xl border border-dashed border-border p-10 text-muted-foreground text-sm w-full">
        Identity reveal — coming in next phase
      </div>
    </div>
  );
}

// ─── Root component ───────────────────────────────────────────────────────────

export function RespondentFlow({
  form,
  questions,
}: {
  form: Form;
  questions: Question[];
}) {
  const [stage, setStage] = useState<Stage>("ENTRY");
  const [questionIndex, setQuestionIndex] = useState(0);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const leftBg = TONE_BG[form.tone] ?? TONE_BG.playful;

  async function handleStart() {
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ form_id: form.id }),
      });
      if (res.ok) {
        const { id } = await res.json();
        setSessionId(id);
      }
    } catch {
      // Don't block the flow — session is best-effort for demo
    }
    setStage("QUESTION");
  }

  function advanceQuestion() {
    if (questionIndex + 1 < questions.length) {
      setQuestionIndex((i) => i + 1);
      setStage("QUESTION");
    } else {
      setStage("COMPLETE");
    }
  }

  async function handleAnswer(rawValue: unknown, transcript?: string) {
    // Persist the answer (best-effort — don't block the flow on failure)
    if (sessionId && questions[questionIndex]) {
      try {
        await fetch("/api/answers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: sessionId,
            question_id: questions[questionIndex].id,
            raw_value: rawValue,
            transcript: transcript ?? null,
          }),
        });
      } catch {
        // continue regardless
      }
    }

    // Show reflection placeholder for 1.5s, then advance
    setStage("REFLECTION");
    setTimeout(advanceQuestion, 1500);
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* ── Left: AI presence (40%) ── */}
      <div
        className="relative w-[40%] flex items-center justify-center overflow-hidden"
        style={{ background: leftBg }}
      >
        {/* Slow-breathing tint overlay */}
        <motion.div
          className="absolute inset-0 pointer-events-none"
          animate={{ opacity: [0.4, 0.75, 0.4] }}
          transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
          style={{ background: leftBg }}
        />
        <AIPresence tone={form.tone} />
      </div>

      {/* ── Right: human expression (60%) ── */}
      <div className="relative w-[60%] bg-background flex items-center justify-center overflow-hidden">
        <AnimatePresence mode="wait">
          {stage === "ENTRY" && (
            <motion.div key="entry" {...fadeUp} className="w-full">
              <EntryScreen
                form={form}
                questions={questions}
                onStart={handleStart}
              />
            </motion.div>
          )}

          {stage === "QUESTION" && questions[questionIndex] && (
            <motion.div
              key={`question-${questionIndex}`}
              {...fadeUp}
              className="w-full"
            >
              <QuestionStage
                question={questions[questionIndex]}
                index={questionIndex}
                total={questions.length}
                sessionId={sessionId}
                tone={form.tone}
                formIntent={form.intent}
                onAnswer={handleAnswer}
              />
            </motion.div>
          )}

          {stage === "REFLECTION" && (
            <motion.div key="reflection" {...fadeUp} className="w-full">
              <ReflectionStage />
            </motion.div>
          )}

          {stage === "COMPLETE" && (
            <motion.div key="complete" {...fadeUp} className="w-full">
              <CompleteStage form={form} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
