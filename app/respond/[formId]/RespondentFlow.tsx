"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { AnimatePresence, motion, type Variants } from "framer-motion";
import { Volume2, VolumeX } from "lucide-react";
import { toast } from "sonner";
import { AIPresence, type AvatarMode } from "@/components/AIPresence";
import { BackgroundMusic } from "@/components/BackgroundMusic";
import { TTSPlayer } from "@/components/TTSPlayer";
import { useLiveData } from "@/hooks/useLiveData";
import { Button } from "@/components/ui/button";
import { VoiceInput } from "@/components/inputs/VoiceInput";
import { TextInput } from "@/components/inputs/TextInput";
import { EmojiSlider } from "@/components/inputs/EmojiSlider";
import { Cards } from "@/components/inputs/Cards";
import { Ranking } from "@/components/inputs/Ranking";
import { ThisOrThat } from "@/components/inputs/ThisOrThat";
import { VisualSelect } from "@/components/inputs/VisualSelect";
import { Reflection } from "@/components/Reflection";
import { CompleteStage } from "@/components/CompleteStage";
import { playTick, playWhoosh, setSoundMuted } from "@/lib/sounds";
import type { Form, Question } from "@/lib/types";
import type { NullReflectionReason, ReflectionResult } from "@/lib/reflection";

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

type Stage = "ENTRY" | "SETUP" | "QUESTION" | "FOLLOWUP" | "REFLECTION" | "COMPLETE";

interface PreloadItem {
  phrased: string;
  audioUrl: string;
}

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

// ─── Tone gradient config ────────────────────────────────────────────────────

const ENTRY_GRADIENT: Record<string, { from: string; to: string }> = {
  playful: { from: "rgba(249,115,22,0.10)", to: "rgba(236,72,153,0.06)" },
  calm: { from: "rgba(59,130,246,0.10)", to: "rgba(20,184,166,0.06)" },
  direct: { from: "rgba(156,163,175,0.08)", to: "rgba(75,85,99,0.04)" },
  insightful: { from: "rgba(139,92,246,0.10)", to: "rgba(99,102,241,0.06)" },
};

// ─── Reaction pop sub-component ──────────────────────────────────────────────

function ReactionPopEmoji({ emoji }: { emoji: string }) {
  const pos = useRef({
    left: `${15 + Math.random() * 70}%`,
    top: `${15 + Math.random() * 60}%`,
    drift: (Math.random() - 0.5) * 50,
  });

  return (
    <motion.span
      className="absolute text-3xl pointer-events-none select-none z-20"
      style={{ left: pos.current.left, top: pos.current.top }}
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: [0, 1.4, 0], opacity: [0, 1, 0], x: pos.current.drift }}
      transition={{ duration: 1.2, ease: "easeOut" }}
    >
      {emoji}
    </motion.span>
  );
}

// ─── Entry screen ─────────────────────────────────────────────────────────────

interface FloatingQuote {
  id: number;
  text: string;
  xOffset: number;
  yBase: number;
  fontScale: number;
  duration: number;
  yPath: [number, number, number, number];
}

function shuffleStrings(values: string[]): string[] {
  const next = [...values];
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

function normalizeRespondentName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function validateRespondentName(value: string): string | null {
  const normalized = normalizeRespondentName(value);
  if (!normalized) return "Tell us what to call you.";
  if (normalized.length > 30) return "Keep it under 30 characters.";
  if (!/^[A-Za-z][A-Za-z\s'-]{0,29}$/.test(normalized)) {
    return "Use letters, spaces, apostrophes, or hyphens.";
  }
  return null;
}

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
  const { count, quotes, reactionCount, reactionPops } = useLiveData(
    form.id,
    questionIds
  );
  const [starting, setStarting] = useState(false);
  const [visibleQuotes, setVisibleQuotes] = useState<FloatingQuote[]>([]);

  const quotesPoolRef = useRef<string[]>([]);
  const quoteCounterRef = useRef(0);
  const recentlyShownRef = useRef<string[]>([]);
  const quoteTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    quotesPoolRef.current = shuffleStrings(quotes);
  }, [quotes]);

  useEffect(() => {
    const reshuffleInterval = setInterval(() => {
      quotesPoolRef.current = shuffleStrings(quotesPoolRef.current);
    }, 30_000);

    function clearQuote(id: number, delay: number) {
      const timeout = setTimeout(() => {
        setVisibleQuotes((prev) => prev.filter((q) => q.id !== id));
      }, delay);
      quoteTimeoutsRef.current.push(timeout);
    }

    function mountQuote(delay = 0) {
      const pool = quotesPoolRef.current;
      if (pool.length === 0) return;
      const recent = new Set(recentlyShownRef.current);
      const candidates = pool.filter((q) => !recent.has(q));
      const source = candidates.length > 0 ? candidates : pool;
      const text = source[Math.floor(Math.random() * source.length)];
      quoteCounterRef.current++;
      const id = quoteCounterRef.current;

      recentlyShownRef.current = [...recentlyShownRef.current.slice(-4), text];

      setVisibleQuotes((prev) => {
        const yBase = Math.floor(Math.random() * 96);
        const tooClose = prev.some((q) => Math.abs(q.yBase - yBase) < 60);
        if (tooClose && delay === 0) {
          const timeout = setTimeout(() => mountQuote(800), 800);
          quoteTimeoutsRef.current.push(timeout);
          return prev;
        }

        const duration = 5 + Math.random() * 2;
        const rise = 82 + Math.random() * 34;
        const quote: FloatingQuote = {
          id,
          text,
          xOffset: Math.floor(Math.random() * 201),
          yBase,
          fontScale: 0.85 + Math.random() * 0.2,
          duration,
          yPath: [70, 35, 0, -rise],
        };
        clearQuote(id, duration * 1000);
        return [...prev.slice(-4), quote];
      });
    }

    const interval = setInterval(() => {
      mountQuote();
    }, 2000);

    return () => {
      clearInterval(interval);
      clearInterval(reshuffleInterval);
      quoteTimeoutsRef.current.forEach(clearTimeout);
      quoteTimeoutsRef.current = [];
    };
  }, []);

  async function handleStart() {
    setStarting(true);
    await onStart().catch(() => setStarting(false));
  }

  const tone = form.tone ?? "calm";
  const g = ENTRY_GRADIENT[tone] ?? ENTRY_GRADIENT.calm;

  return (
    <div className="relative w-full h-full flex items-center justify-center overflow-hidden">
      {/* Tone-based shifting gradient background */}
      <motion.div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `linear-gradient(135deg, ${g.from} 0%, transparent 50%, ${g.to} 100%)`,
          backgroundSize: "200% 200%",
        }}
        animate={{ backgroundPosition: ["0% 0%", "100% 100%", "0% 0%"] }}
        transition={{ duration: 25, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* Content */}
      <div className="relative z-10 flex flex-col gap-7 px-12 py-16 max-w-lg w-full">
        {/* Live badges */}
        <div className="flex items-center gap-3 flex-wrap">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-400 ring-1 ring-emerald-500/20">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            {count > 0 ? `${count} people responded` : "Live"}
          </span>
          {reactionCount > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-400 ring-1 ring-amber-500/20">
              {reactionCount} reactions
            </span>
          )}
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

        {/* Floating quotes */}
        <div className="relative min-h-[150px] overflow-hidden">
          <AnimatePresence>
            {visibleQuotes.length > 0 ? (
              visibleQuotes.map((vq) => (
                <motion.p
                  key={vq.id}
                  className="absolute text-sm text-muted-foreground/40 italic leading-relaxed"
                  style={{
                    left: `${vq.xOffset}px`,
                    top: `${vq.yBase}px`,
                    fontSize: `${vq.fontScale}em`,
                  }}
                  initial={{ opacity: 0, y: vq.yPath[0] }}
                  animate={{ opacity: [0, 0.6, 0.6, 0], y: vq.yPath }}
                  transition={{
                    duration: vq.duration,
                    times: [0, 0.1, 0.85, 1],
                    ease: "easeInOut",
                  }}
                >
                  &ldquo;{vq.text}&rdquo;
                </motion.p>
              ))
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

        {/* CTA with breathing animation */}
        <motion.div
          className="w-fit"
          animate={{ scale: [1, 1.04, 1] }}
          transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
        >
          <Button
            size="lg"
            className="text-base px-8"
            onClick={handleStart}
            disabled={starting}
          >
            {starting ? "Starting…" : "Let's start →"}
          </Button>
        </motion.div>

        {/* Question count */}
        <p className="text-xs text-muted-foreground">
          {questions.length} question{questions.length !== 1 ? "s" : ""}
        </p>
      </div>

      {/* Reaction pops overlay */}
      {reactionPops.map((pop) => (
        <ReactionPopEmoji key={pop.id} emoji={pop.emoji} />
      ))}
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

function SetupScreen({
  progress,
  canContinue,
  hasError,
  name,
  nameError,
  onNameChange,
  onContinue,
}: {
  progress: number;
  canContinue: boolean;
  hasError: boolean;
  name: string;
  nameError: string | null;
  onNameChange: (value: string) => void;
  onContinue: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && canContinue) {
      onContinue();
    }
  }

  return (
    <div className="relative w-full h-full flex items-center justify-center overflow-hidden">
      <motion.div
        className="absolute inset-0 pointer-events-none"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        style={{
          background:
            "radial-gradient(circle at 30% 20%, rgba(139,92,246,0.12), transparent 34%), radial-gradient(circle at 80% 75%, rgba(59,130,246,0.10), transparent 30%)",
        }}
      />

      <div className="relative z-10 flex flex-col gap-7 px-10 py-14 max-w-xl w-full">
        <div className="space-y-4">
          <motion.p
            className="text-xs font-medium tracking-[0.24em] uppercase text-muted-foreground"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45 }}
          >
            The room is getting ready
          </motion.p>
          <motion.h1
            className="text-4xl font-bold tracking-tight leading-tight"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08, duration: 0.5, ease: "easeOut" }}
          >
            A voice will meet you here.
          </motion.h1>
          <motion.p
            className="text-base leading-relaxed text-muted-foreground max-w-md"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.16, duration: 0.5, ease: "easeOut" }}
          >
            Answer naturally. Pulse will listen, ask back, and reveal the
            invisible patterns forming around your responses.
          </motion.p>
        </div>

        <motion.div
          className="grid grid-cols-3 gap-2 max-w-md"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.24, duration: 0.45 }}
        >
          {["Speak freely", "See the room", "Leave with a signal"].map((text) => (
            <div
              key={text}
              className="rounded-2xl border border-foreground/[0.06] bg-foreground/[0.03] px-3 py-3 text-center text-[11px] leading-tight text-muted-foreground/80"
            >
              {text}
            </div>
          ))}
        </motion.div>

        <motion.div
          className="w-full max-w-sm"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.32, duration: 0.5, ease: "easeOut" }}
        >
          <input
            ref={inputRef}
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="What should we call you?"
            className="w-full rounded-2xl border border-foreground/[0.08] bg-background/70 px-5 py-4 text-lg text-foreground placeholder:text-muted-foreground/45 shadow-[0_12px_40px_rgba(0,0,0,0.10)] outline-none backdrop-blur transition-colors focus:border-foreground/30"
            maxLength={30}
          />
          {nameError && (
            <p className="mt-2 text-xs text-muted-foreground/70">
              {nameError}
            </p>
          )}
        </motion.div>

        <motion.div
          className="space-y-3 max-w-md"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.45 }}
        >
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-foreground/[0.08]">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-violet-300 via-foreground/80 to-blue-300"
              initial={{ width: 0 }}
              animate={{ width: `${Math.round(progress * 100)}%` }}
              transition={{ duration: 0.35, ease: "easeOut" }}
            />
          </div>
          <p className="text-xs text-muted-foreground/70">
            {hasError
              ? "A few things are still tuning themselves. You can begin; Pulse will catch up gracefully."
              : "Preparing the voice, pacing the questions, opening the signal."}
          </p>
        </motion.div>

        <motion.div
          className="w-fit"
          animate={canContinue ? { scale: [1, 1.04, 1] } : { scale: 1 }}
          transition={{ duration: 2.2, repeat: canContinue ? Infinity : 0, ease: "easeInOut" }}
        >
          <Button
            size="lg"
            className="text-base px-8"
            onClick={onContinue}
            disabled={!canContinue}
          >
            Begin the conversation →
          </Button>
        </motion.div>
      </div>
    </div>
  );
}

// ─── Question stage ───────────────────────────────────────────────────────────

// ms between each character the typewriter drains from the queue
const TYPEWRITER_INTERVAL_MS = 28;
const INPUT_REVEAL_DELAY_MS = 400;

function QuestionStage({
  question,
  index,
  total,
  sessionId,
  tone,
  formIntent,
  onAnswer,
  onPhrasedReady,
  ttsDisplayText,
  ttsDone,
  preamble,
  preloaded,
  respondentName,
}: {
  question: Question;
  index: number;
  total: number;
  sessionId: string | null;
  tone: string;
  formIntent: string | null;
  onAnswer: (rawValue: unknown, transcript?: string) => void;
  onPhrasedReady: (text: string, audioUrl?: string | null) => void;
  ttsDisplayText: string;
  ttsDone: boolean;
  preamble?: string;
  preloaded?: PreloadItem | null;
  respondentName?: string | null;
}) {
  const { input_type, options } = question;
  const [phrased, setPhrased] = useState<string | null>(null);
  const [thinking, setThinking] = useState(true);
  const [pendingTypewriterText, setPendingTypewriterText] = useState<string | null>(null);
  // inputReady gates the answer UI — true only after typewriter finishes + delay
  const [inputReady, setInputReady] = useState(false);

  // ── Typewriter internals (refs so they don't trigger re-renders) ──
  const charQueueRef = useRef<string[]>([]);
  const displayedRef = useRef<string>("");
  const typingActiveRef = useRef(false);
  const streamDoneRef = useRef(false);
  const firstCharRef = useRef(false);
  const typewriterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ttsFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stable ref for onPhrasedReady so the fetch effect doesn't re-run on re-renders
  const onPhrasedReadyRef = useRef(onPhrasedReady);
  useEffect(() => { onPhrasedReadyRef.current = onPhrasedReady; }, [onPhrasedReady]);

  useEffect(() => {
    if (!pendingTypewriterText) return;

    if (ttsDisplayText) {
      if (ttsFallbackTimerRef.current) {
        clearTimeout(ttsFallbackTimerRef.current);
        ttsFallbackTimerRef.current = null;
      }
      setPhrased(ttsDisplayText);
      setThinking(false);
    }

    if (ttsDone) {
      setPhrased(pendingTypewriterText);
      setThinking(false);
      setPendingTypewriterText(null);
      revealInputs(INPUT_REVEAL_DELAY_MS);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingTypewriterText, ttsDisplayText, ttsDone]);

  function revealInputs(delay: number) {
    if (inputTimerRef.current) clearTimeout(inputTimerRef.current);
    inputTimerRef.current = setTimeout(() => setInputReady(true), delay);
  }

  function startTypewriter() {
    if (typingActiveRef.current) return;
    typingActiveRef.current = true;

    function tick() {
      const ch = charQueueRef.current.shift();
      if (ch !== undefined) {
        displayedRef.current += ch;
        setPhrased(displayedRef.current);
        setThinking(false);
        typewriterTimerRef.current = setTimeout(tick, TYPEWRITER_INTERVAL_MS);
      } else if (streamDoneRef.current) {
        typingActiveRef.current = false;
        setPhrased(displayedRef.current);
        setThinking(false);
        revealInputs(INPUT_REVEAL_DELAY_MS);
      } else {
        typingActiveRef.current = false;
      }
    }

    typewriterTimerRef.current = setTimeout(tick, TYPEWRITER_INTERVAL_MS);
  }

  function startTypewriterWithText(text: string) {
    if (typewriterTimerRef.current) clearTimeout(typewriterTimerRef.current);
    charQueueRef.current = [...text];
    displayedRef.current = "";
    streamDoneRef.current = true;
    startTypewriter();
  }

  useEffect(() => {
    let cancelled = false;
    let ttsTriggered = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    // Reset all typewriter state for the new question
    if (typewriterTimerRef.current) clearTimeout(typewriterTimerRef.current);
    if (inputTimerRef.current) clearTimeout(inputTimerRef.current);
    if (ttsFallbackTimerRef.current) clearTimeout(ttsFallbackTimerRef.current);
    charQueueRef.current = [];
    displayedRef.current = "";
    typingActiveRef.current = false;
    streamDoneRef.current = false;
    firstCharRef.current = false;

    setPhrased(null);
    setThinking(true);
    setInputReady(false);
    setPendingTypewriterText(null);

    function queueForTtsThenType(text: string, audioUrl?: string | null) {
      ttsTriggered = true;
      onPhrasedReadyRef.current(text, audioUrl);
      setPendingTypewriterText(text);
      ttsFallbackTimerRef.current = setTimeout(() => {
        if (!typingActiveRef.current) startTypewriterWithText(text);
      }, 5000);
    }

    if (preloaded) {
      clearTimeout(timeout);
      queueForTtsThenType(preloaded.phrased, preloaded.audioUrl);
      return () => {
        cancelled = true;
        if (typewriterTimerRef.current) clearTimeout(typewriterTimerRef.current);
        if (inputTimerRef.current) clearTimeout(inputTimerRef.current);
        if (ttsFallbackTimerRef.current) clearTimeout(ttsFallbackTimerRef.current);
      };
    }

    // ── Client-side sessionStorage cache ──
    const clientCacheKey =
      sessionId ? `phrase:${sessionId}:${question.id}` : null;

    if (clientCacheKey && typeof sessionStorage !== "undefined") {
      const cached = sessionStorage.getItem(clientCacheKey);
      if (cached) {
        clearTimeout(timeout);
        queueForTtsThenType(cached);
        return () => {
          cancelled = true;
          if (inputTimerRef.current) clearTimeout(inputTimerRef.current);
        };
      }
    }

    fetch("/api/phrase-question", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question_prompt: question.prompt,
        tone,
        form_intent: formIntent,
        session_id: sessionId,
        respondent_name: respondentName,
      }),
      signal: controller.signal,
    })
      .then(async (res) => {
        if (cancelled) return;
        clearTimeout(timeout);

        const ct = res.headers.get("content-type") ?? "";

        if (ct.includes("application/json")) {
          const { phrased: p } = (await res.json()) as { phrased?: string };
          if (!cancelled) {
            const text = p || question.prompt;
            if (p && clientCacheKey && typeof sessionStorage !== "undefined") {
              sessionStorage.setItem(clientCacheKey, p);
            }
            queueForTtsThenType(text);
          }
          return;
        }

        // ── SSE stream → typewriter queue ──
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let sseBuffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done || cancelled) break;

          sseBuffer += decoder.decode(value, { stream: true });
          const lines = sseBuffer.split("\n");
          sseBuffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();

            try {
              const parsed = JSON.parse(data) as Record<string, unknown>;

              if (typeof parsed.chunk === "string") {
                // The LLM stream is now fast enough to buffer. Starting the
                // visible typewriter on final text lets TTS start at the same time.
              } else if (parsed.done && typeof parsed.phrased === "string") {
                if (clientCacheKey && typeof sessionStorage !== "undefined") {
                  sessionStorage.setItem(clientCacheKey, parsed.phrased);
                }
                queueForTtsThenType(parsed.phrased);
              } else if (parsed.error) {
                const fallback =
                  typeof parsed.fallback === "string"
                    ? parsed.fallback
                    : question.prompt;
                queueForTtsThenType(fallback);
              }
            } catch {
              // skip malformed SSE lines
            }
          }
        }

        if (!cancelled && !ttsTriggered) setThinking(false);
      })
      .catch(() => {
        if (!cancelled && !ttsTriggered) {
          setPhrased(question.prompt);
          setThinking(false);
          revealInputs(200);
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timeout);
      if (typewriterTimerRef.current) clearTimeout(typewriterTimerRef.current);
      if (inputTimerRef.current) clearTimeout(inputTimerRef.current);
      if (ttsFallbackTimerRef.current) clearTimeout(ttsFallbackTimerRef.current);
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
        {preamble ?? `${index + 1} / ${total}`}
      </p>

      {/* Prompt: phrase stream drives the visible typewriter immediately.
          TTS starts once the final phrasing is known, but text no longer waits
          for the audio blob to finish downloading before it appears. */}
      <AnimatePresence mode="popLayout">
        {thinking ? (
          <motion.div
            key="thinking"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <ThinkingDots />
          </motion.div>
        ) : (
          <motion.h2
            key="prompt"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: "easeOut" as const }}
            className="text-2xl font-medium leading-snug"
          >
            {phrased ?? question.prompt}
          </motion.h2>
        )}
      </AnimatePresence>

      {/* Input — revealed only after the question has fully streamed in */}
      <AnimatePresence>
        {inputReady && (
          <motion.div
            key="input-area"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" as const }}
          >
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
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Follow-up stage ──────────────────────────────────────────────────────────

function FollowUpStage({
  prompt,
  inputType,
  sessionId,
  tone,
  questionIntent,
  onAnswer,
  onPhrasedReady,
  ttsDisplayText,
  ttsDone,
  preloaded,
  respondentName,
}: {
  prompt: string;
  inputType: "voice" | "text";
  sessionId: string | null;
  tone: string;
  questionIntent: string | null;
  onAnswer: (rawValue: unknown, transcript?: string) => void;
  onPhrasedReady: (text: string, audioUrl?: string | null) => void;
  ttsDisplayText: string;
  ttsDone: boolean;
  preloaded?: PreloadItem | null;
  respondentName?: string | null;
}) {
  // Stub question satisfies component prop contracts
  const stubQuestion = {
    id: `followup-${prompt}`,
    form_id: "",
    position: -1,
    prompt,
    intent: questionIntent,
    input_type: inputType,
    options: null,
    follow_up_enabled: false,
    required: false,
  } satisfies Question;

  return (
    <QuestionStage
      question={stubQuestion}
      index={-1}
      total={0}
      sessionId={sessionId}
      tone={tone}
      formIntent={questionIntent}
      onAnswer={onAnswer}
      onPhrasedReady={onPhrasedReady}
      ttsDisplayText={ttsDisplayText}
      ttsDone={ttsDone}
      preamble="One more thing…"
      preloaded={preloaded}
      respondentName={respondentName}
    />
  );
}

function NullReflectionCard({
  nullReason,
  debugInfo,
}: {
  nullReason: NullReflectionReason | null;
  debugInfo: string | null;
}) {
  const showDebug = process.env.NEXT_PUBLIC_REFLECTION_DEBUG === "true";

  return (
    <div className="flex flex-col items-center justify-center h-32 gap-2">
      <motion.p
        className="text-muted-foreground text-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.25 }}
      >
        Moving on…
      </motion.p>
      {showDebug && (debugInfo || nullReason) && (
        <p className="text-xs uppercase text-muted-foreground/40">
          [{nullReason ?? "unknown"}{debugInfo ? `: ${debugInfo}` : ""}]
        </p>
      )}
    </div>
  );
}

// ─── Fetch with retry helper ─────────────────────────────────────────────────

async function fetchWithRetry(
  url: string,
  opts: RequestInit,
  retries = 1
): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, opts);
      if (res.ok) return res;
      if (i < retries) continue;
      return res;
    } catch (e) {
      lastErr = e;
      if (i >= retries) break;
    }
  }
  throw lastErr;
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
  const [respondentName, setRespondentName] = useState("");
  const [respondentNameSaved, setRespondentNameSaved] = useState<string | null>(null);
  const [followUpPrompt, setFollowUpPrompt] = useState<string | null>(null);
  const [reflectionData, setReflectionData] = useState<ReflectionResult | null>(null);
  const [nullReason, setNullReason] = useState<NullReflectionReason | null>(null);
  const [nullDebugInfo, setNullDebugInfo] = useState<string | null>(null);
  const [avatarMode, setAvatarMode] = useState<AvatarMode>("idle");
  const pendingReflectionRef = useRef<ReflectionResult | null>(null);
  const pendingNullReasonRef = useRef<NullReflectionReason | null>(null);
  const pendingNullDebugInfoRef = useRef<string | null>(null);
  const reflectionHistoryRef = useRef<ReflectionResult["type"][]>([]);
  const nullReflectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── TTS state ──
  const [muted, setMuted] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("pulse-tts-muted") === "true";
  });
  const [musicActive, setMusicActive] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [phrasedForTTS, setPhrasedForTTS] = useState<string | null>(null);
  const [preloadedAudioUrlForTTS, setPreloadedAudioUrlForTTS] = useState<string | null>(null);
  const [ttsDisplayText, setTtsDisplayText] = useState("");
  const [ttsDone, setTtsDone] = useState(false);
  const [preloadProgress, setPreloadProgress] = useState(0);
  const [setupMinElapsed, setSetupMinElapsed] = useState(false);
  const [preloadError, setPreloadError] = useState(false);

  // ── Preload cache ──
  const preloadCacheRef = useRef<Map<string, PreloadItem>>(new Map());
  const preloadStartedRef = useRef(false);
  const preloadNameRef = useRef<string | null>(null);

  function toggleMute() {
    setMuted((prev) => {
      const next = !prev;
      localStorage.setItem("pulse-tts-muted", String(next));
      setSoundMuted(next);
      return next;
    });
  }

  // Sync sound mute on mount
  useEffect(() => {
    setSoundMuted(muted);
  }, [muted]);

  const leftBg = TONE_BG[form.tone] ?? TONE_BG.playful;
  const respondentNameError = respondentName ? validateRespondentName(respondentName) : "Tell us what to call you.";
  const respondentNameValid = respondentNameError === null;

  function handlePhrasedReady(text: string, audioUrl?: string | null) {
    setPhrasedForTTS(text);
    setPreloadedAudioUrlForTTS(audioUrl ?? null);
  }

  async function preloadQuestion(
    q: Question,
    activeSessionId: string,
    activeName: string | null,
    onAssetDone: () => void
  ) {
    const phraseRes = await fetch("/api/phrase-question", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question_prompt: q.prompt,
        tone: form.tone,
        form_intent: form.intent,
        session_id: activeSessionId,
        respondent_name: activeName,
        response_mode: "json",
      }),
    });

    const { phrased } = (await phraseRes.json()) as { phrased?: string };
    const text = phrased || q.prompt;
    if (preloadNameRef.current !== activeName) return;
    onAssetDone();

    const ttsRes = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, tone: form.tone }),
    });
    if (!ttsRes.ok) throw new Error(`TTS preload failed: ${ttsRes.status}`);
    const audioBlob = await ttsRes.blob();
    const audioUrl = URL.createObjectURL(audioBlob);
    if (preloadNameRef.current !== activeName) {
      URL.revokeObjectURL(audioUrl);
      return;
    }
    const old = preloadCacheRef.current.get(q.id);
    if (old?.audioUrl) URL.revokeObjectURL(old.audioUrl);
    preloadCacheRef.current.set(q.id, { phrased: text, audioUrl });
    onAssetDone();
  }

  async function preloadAll(activeSessionId: string, activeName: string | null) {
    if (preloadStartedRef.current && preloadNameRef.current === activeName) return;
    if (preloadNameRef.current !== activeName) {
      preloadCacheRef.current.forEach(({ audioUrl }) => URL.revokeObjectURL(audioUrl));
      preloadCacheRef.current.clear();
      preloadStartedRef.current = false;
    }
    preloadStartedRef.current = true;
    preloadNameRef.current = activeName;
    setPreloadProgress(0);
    setPreloadError(false);

    let completed = 0;
    const total = questions.length * 2;
    const markDone = () => {
      completed += 1;
      setPreloadProgress(Math.min(1, completed / total));
    };

    const results = await Promise.allSettled(
      questions.map((q) => preloadQuestion(q, activeSessionId, activeName, markDone))
    );

    if (results.some((r) => r.status === "rejected")) {
      setPreloadError(true);
    }
  }

  useEffect(() => {
    return () => {
      preloadCacheRef.current.forEach(({ audioUrl }) => {
        URL.revokeObjectURL(audioUrl);
      });
      preloadCacheRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (stage !== "SETUP") return;

    setSetupMinElapsed(false);
    const minTimer = setTimeout(() => setSetupMinElapsed(true), 3000);

    return () => {
      clearTimeout(minTimer);
    };
  }, [stage]);

  useEffect(() => {
    if (stage !== "SETUP" || preloadProgress < 1 || !respondentNameValid) return;
    const autoTimer = setTimeout(() => {
      void handleSetupContinue();
    }, 8000);
    return () => clearTimeout(autoTimer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, preloadProgress, respondentNameValid]);

  useEffect(() => {
    if (stage !== "SETUP" || !sessionId || !respondentNameValid) return;
    void preloadAll(sessionId, normalizeRespondentName(respondentName));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, sessionId, respondentNameValid, respondentName]);

  async function handleSetupContinue() {
    if (!sessionId || !respondentNameValid) return;
    const name = normalizeRespondentName(respondentName);
    try {
      const res = await fetch("/api/sessions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          respondent_name: name,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { respondent_name?: string | null };
        setRespondentNameSaved(data.respondent_name ?? name);
      } else {
        setRespondentNameSaved(name);
      }
    } catch {
      setRespondentNameSaved(name);
    }
    setAvatarMode("thinking");
    setStage("QUESTION");
  }

  // Preload next question phrasing during reflection
  const preloadNextQuestion = useCallback(() => {
    const nextIdx = questionIndex + 1;
    if (nextIdx >= questions.length || !sessionId) return;
    const nextQ = questions[nextIdx];
    if (preloadCacheRef.current.has(nextQ.id)) return;

    void preloadQuestion(nextQ, sessionId, respondentNameSaved, () => {});
  }, [questionIndex, questions, form.tone, form.intent, sessionId, respondentNameSaved]);

  useEffect(() => {
    if (stage === "REFLECTION") {
      preloadNextQuestion();
    }
  }, [stage, preloadNextQuestion]);

  // Update avatar mode based on stage
  useEffect(() => {
    if (stage === "QUESTION" && !phrasedForTTS && !isSpeaking) {
      setAvatarMode("thinking");
    } else if (stage === "ENTRY" || stage === "COMPLETE") {
      setAvatarMode("idle");
    }
  }, [stage, phrasedForTTS, isSpeaking]);

  async function handleStart() {
    playTick();
    setMusicActive(true);
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ form_id: form.id }),
      });
      if (res.ok) {
        const { id } = await res.json();
        setSessionId(id);
        setAvatarMode("idle");
        setStage("SETUP");
        return;
      }
    } catch {
      // Don't block the flow — session is best-effort for demo
    }
    setPreloadError(true);
    setAvatarMode("idle");
    setStage("SETUP");
  }

  function advanceQuestion() {
    playTick();
    if (nullReflectionTimerRef.current) {
      clearTimeout(nullReflectionTimerRef.current);
      nullReflectionTimerRef.current = null;
    }
    setPhrasedForTTS(null);
    setPreloadedAudioUrlForTTS(null);
    setIsSpeaking(false);
    setTtsDisplayText("");
    setTtsDone(false);
    setReflectionData(null);
    setNullReason(null);
    setNullDebugInfo(null);
    pendingReflectionRef.current = null;
    pendingNullReasonRef.current = null;
    pendingNullDebugInfoRef.current = null;
    setAvatarMode("thinking");
    if (questionIndex + 1 < questions.length) {
      setQuestionIndex((i) => i + 1);
      setStage("QUESTION");
    } else {
      setAvatarMode("idle");
      setStage("COMPLETE");
    }
  }

  async function handleAnswer(rawValue: unknown, transcript?: string) {
    const currentQuestion = questions[questionIndex];
    let reflection: ReflectionResult | null = null;

    if (sessionId && currentQuestion) {
      try {
        const res = await fetchWithRetry(
          "/api/answers",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              session_id: sessionId,
              question_id: currentQuestion.id,
              raw_value: rawValue,
              transcript: transcript ?? null,
              reflection_history: reflectionHistoryRef.current,
            }),
          },
          1
        );
        if (res.ok) {
          const data = (await res.json()) as {
            reflection?: ReflectionResult | null;
            null_reason?: NullReflectionReason | null;
            debug_info?: string | null;
          };
          reflection = (data.reflection as ReflectionResult) ?? null;
          if (reflection?.type) {
            reflectionHistoryRef.current = [
              ...reflectionHistoryRef.current.slice(-5),
              reflection.type,
            ];
          }
          pendingNullReasonRef.current = data.null_reason ?? null;
          pendingNullDebugInfoRef.current = data.debug_info ?? null;
        } else {
          toast.error("Connection hiccup, please try again");
        }
      } catch {
        toast.error("Connection hiccup, please try again");
      }
    }

    const eligibleForFollowUp =
      currentQuestion?.follow_up_enabled &&
      (currentQuestion.input_type === "voice" ||
        currentQuestion.input_type === "text") &&
      typeof transcript === "string" &&
      transcript.trim().length > 0;

    if (eligibleForFollowUp) {
      try {
        const res = await fetch("/api/follow-up", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question_prompt: currentQuestion.prompt,
            question_intent: currentQuestion.intent,
            answer_text: transcript,
            tone: form.tone,
          }),
        });
        if (res.ok) {
          const { follow_up } = await res.json();
          if (follow_up) {
            pendingReflectionRef.current = reflection;
            setFollowUpPrompt(follow_up);
            setPhrasedForTTS(null);
            setIsSpeaking(false);
            setTtsDisplayText("");
            setTtsDone(false);
            setAvatarMode("thinking");
            playTick();
            setStage("FOLLOWUP");
            return;
          }
        }
      } catch {
        // fall through to REFLECTION
      }
    }

    goToReflection(
      reflection,
      pendingNullReasonRef.current,
      pendingNullDebugInfoRef.current
    );
  }

  async function handleFollowUpAnswer(rawValue: unknown, transcript?: string) {
    const currentQuestion = questions[questionIndex];
    let followUpReflection: ReflectionResult | null = null;
    if (sessionId && currentQuestion) {
      try {
        const res = await fetchWithRetry(
          "/api/answers",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              session_id: sessionId,
              question_id: currentQuestion.id,
              raw_value: rawValue,
              transcript: transcript ?? null,
              reflection_history: reflectionHistoryRef.current,
            }),
          },
          1
        );
        if (res.ok) {
          const data = (await res.json()) as {
            reflection?: ReflectionResult | null;
            null_reason?: NullReflectionReason | null;
            debug_info?: string | null;
          };
          followUpReflection = (data.reflection as ReflectionResult) ?? null;
          if (followUpReflection?.type) {
            reflectionHistoryRef.current = [
              ...reflectionHistoryRef.current.slice(-5),
              followUpReflection.type,
            ];
          }
          pendingNullReasonRef.current = data.null_reason ?? null;
          pendingNullDebugInfoRef.current = data.debug_info ?? null;
        }
      } catch {
        toast.error("Connection hiccup, please try again");
      }
    }
    goToReflection(
      followUpReflection ?? pendingReflectionRef.current,
      pendingNullReasonRef.current,
      pendingNullDebugInfoRef.current
    );
  }

  function goToReflection(
    reflection?: ReflectionResult | null,
    reason?: NullReflectionReason | null,
    debugInfo?: string | null
  ) {
    if (nullReflectionTimerRef.current) {
      clearTimeout(nullReflectionTimerRef.current);
      nullReflectionTimerRef.current = null;
    }
    const ref = reflection ?? null;
    setPhrasedForTTS(null);
    setPreloadedAudioUrlForTTS(null);
    setIsSpeaking(false);
    setTtsDisplayText("");
    setTtsDone(false);
    setFollowUpPrompt(null);
    setReflectionData(ref);
    setNullReason(ref ? null : reason ?? null);
    setNullDebugInfo(ref ? null : debugInfo ?? null);
    setAvatarMode("idle");
    if (ref) playWhoosh();
    playTick();
    setStage("REFLECTION");
    if (!ref) {
      nullReflectionTimerRef.current = setTimeout(advanceQuestion, 2000);
    }
  }

  function handleSpeakingChange(speaking: boolean) {
    setIsSpeaking(speaking);
    setAvatarMode(speaking ? "speaking" : "idle");
  }

  return (
    <div className="flex flex-col md:flex-row h-screen overflow-hidden">
      {/* ── Mute toggle — fixed overlay, always accessible ── */}
      <button
        onClick={toggleMute}
        className="fixed top-4 right-4 z-50 flex items-center justify-center w-9 h-9 rounded-full bg-background/80 backdrop-blur border border-border shadow-sm hover:bg-muted transition-colors"
        aria-label={muted ? "Unmute" : "Mute"}
        title={muted ? "Unmute" : "Mute"}
      >
        {muted ? (
          <VolumeX className="h-4 w-4 text-muted-foreground" />
        ) : (
          <Volume2 className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      <BackgroundMusic
        active={musicActive}
        ducking={isSpeaking}
        muted={muted}
      />

      {/* ── Left: AI presence (40% desktop, top banner mobile) ── */}
      <div
        className="relative w-full h-28 md:h-auto md:w-[40%] flex flex-col items-center justify-center overflow-hidden shrink-0"
        style={{ background: leftBg }}
      >
        {/* Slow-breathing tint overlay */}
        <motion.div
          className="absolute inset-0 pointer-events-none"
          animate={{ opacity: [0.4, 0.75, 0.4] }}
          transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
          style={{ background: leftBg }}
        />
        <div className="relative flex-1 flex items-center justify-center w-full md:scale-100 scale-[0.45]">
          <AIPresence tone={form.tone} mode={avatarMode} speaking={isSpeaking} />
        </div>

        {/* TTS audio player — drives text reveal in QuestionStage via onDisplayedTextChange */}
        {phrasedForTTS && (stage === "QUESTION" || stage === "FOLLOWUP") && (
          <div className="relative z-10 pb-2 md:pb-8 flex justify-center">
            <TTSPlayer
              key={`tts-${stage}-${questionIndex}-${phrasedForTTS}`}
              text={phrasedForTTS}
              tone={form.tone}
              muted={muted}
              preloadedAudioUrl={preloadedAudioUrlForTTS}
              onSpeakingChange={handleSpeakingChange}
              onDisplayedTextChange={(text, isDone) => {
                setTtsDisplayText(text);
                if (isDone) setTtsDone(true);
              }}
            />
          </div>
        )}
      </div>

      {/* ── Right: human expression (60% desktop, rest mobile) ── */}
      <div className="relative flex-1 md:w-[60%] bg-background flex items-center justify-center overflow-hidden">
        <AnimatePresence mode="wait">
          {stage === "ENTRY" && (
            <motion.div key="entry" {...fadeUp} className="w-full h-full">
              <EntryScreen
                form={form}
                questions={questions}
                onStart={handleStart}
              />
            </motion.div>
          )}

          {stage === "SETUP" && (
            <motion.div key="setup" {...fadeUp} className="w-full h-full">
              <SetupScreen
                progress={preloadProgress}
                canContinue={
                  respondentNameValid &&
                  setupMinElapsed &&
                  (preloadProgress >= 0.6 || preloadError)
                }
                hasError={preloadError}
                name={respondentName}
                nameError={respondentName ? respondentNameError : null}
                onNameChange={setRespondentName}
                onContinue={handleSetupContinue}
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
                onPhrasedReady={handlePhrasedReady}
                ttsDisplayText={ttsDisplayText}
                ttsDone={ttsDone}
                preloaded={preloadCacheRef.current.get(questions[questionIndex].id) ?? null}
                respondentName={respondentNameSaved}
              />
            </motion.div>
          )}

          {stage === "FOLLOWUP" && followUpPrompt && (
            <motion.div key="followup" {...fadeUp} className="w-full">
              <FollowUpStage
                prompt={followUpPrompt}
                inputType={
                  questions[questionIndex]?.input_type === "voice"
                    ? "voice"
                    : "text"
                }
                sessionId={sessionId}
                tone={form.tone}
                questionIntent={questions[questionIndex]?.intent ?? null}
                onAnswer={handleFollowUpAnswer}
                onPhrasedReady={handlePhrasedReady}
                ttsDisplayText={ttsDisplayText}
                ttsDone={ttsDone}
                respondentName={respondentNameSaved}
              />
            </motion.div>
          )}

          {stage === "REFLECTION" && (
            <motion.div key="reflection" {...fadeUp} className="w-full flex items-center justify-center">
              {reflectionData ? (
                <Reflection
                  reflection={reflectionData}
                  sessionId={sessionId}
                  questionId={questions[questionIndex]?.id ?? ""}
                  questionInputType={questions[questionIndex]?.input_type}
                  onDone={advanceQuestion}
                />
              ) : (
                <NullReflectionCard
                  nullReason={nullReason}
                  debugInfo={nullDebugInfo}
                />
              )}
            </motion.div>
          )}

          {stage === "COMPLETE" && (
            <motion.div key="complete" {...fadeUp} className="w-full h-full">
              <CompleteStage form={form} sessionId={sessionId} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
