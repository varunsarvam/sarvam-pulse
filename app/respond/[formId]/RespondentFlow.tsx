"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { AnimatePresence, motion, type Variants } from "framer-motion";
import { Volume2, VolumeX } from "lucide-react";
import { toast } from "sonner";
import { AIPresence, type AvatarMode } from "@/components/AIPresence";
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

type Stage = "ENTRY" | "QUESTION" | "FOLLOWUP" | "REFLECTION" | "COMPLETE";

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

  useEffect(() => {
    quotesPoolRef.current = quotes;
  }, [quotes]);

  useEffect(() => {
    const interval = setInterval(() => {
      const pool = quotesPoolRef.current;
      if (pool.length === 0) return;
      const text = pool[quoteCounterRef.current % pool.length];
      quoteCounterRef.current++;
      const id = quoteCounterRef.current;
      const xOffset = (id * 37) % 40;
      setVisibleQuotes((prev) => [...prev.slice(-4), { id, text, xOffset }]);
      setTimeout(() => {
        setVisibleQuotes((prev) => prev.filter((q) => q.id !== id));
      }, 6000);
    }, 2000);
    return () => clearInterval(interval);
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
        <div className="relative min-h-[120px] overflow-hidden">
          <AnimatePresence>
            {visibleQuotes.length > 0 ? (
              visibleQuotes.map((vq) => (
                <motion.p
                  key={vq.id}
                  className="absolute text-sm text-muted-foreground/40 italic leading-relaxed"
                  style={{ paddingLeft: `${vq.xOffset}px` }}
                  initial={{ opacity: 0, y: 80 }}
                  animate={{ opacity: [0, 0.6, 0.6, 0], y: [80, 40, 10, -20] }}
                  transition={{
                    duration: 6,
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

// ─── Question stage ───────────────────────────────────────────────────────────

// ms between each character the typewriter drains from the queue
const TYPEWRITER_INTERVAL_MS = 28;

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
}: {
  question: Question;
  index: number;
  total: number;
  sessionId: string | null;
  tone: string;
  formIntent: string | null;
  onAnswer: (rawValue: unknown, transcript?: string) => void;
  onPhrasedReady: (text: string) => void;
  ttsDisplayText: string;
  ttsDone: boolean;
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
      revealInputs(250);
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
        revealInputs(250);
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

    function queueForTtsThenType(text: string) {
      ttsTriggered = true;
      onPhrasedReadyRef.current(text);
      setPendingTypewriterText(text);
      ttsFallbackTimerRef.current = setTimeout(() => {
        if (!typingActiveRef.current) startTypewriterWithText(text);
      }, 5000);
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
        {index + 1} / {total}
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
  onAnswer,
}: {
  prompt: string;
  inputType: "voice" | "text";
  onAnswer: (rawValue: unknown, transcript?: string) => void;
}) {
  function handleVoice(v: { type: "voice"; value: string; audioBlob: Blob }) {
    onAnswer({ type: "voice", value: v.value }, v.value);
  }
  function handleText(v: { type: "text"; value: string }) {
    onAnswer(v);
  }

  // Stub question satisfies component prop contracts
  const stubQuestion = {
    id: "followup",
    form_id: "",
    position: -1,
    prompt,
    intent: null,
    input_type: inputType,
    options: null,
    follow_up_enabled: false,
    required: false,
  } as const;

  return (
    <div className="flex flex-col gap-6 px-12 py-14 max-w-lg w-full">
      <p className="text-xs font-medium tracking-widest uppercase text-muted-foreground">
        One more thing…
      </p>
      <motion.h2
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" as const }}
        className="text-2xl font-medium leading-snug"
      >
        {prompt}
      </motion.h2>
      {inputType === "voice" ? (
        <VoiceInput question={stubQuestion} onSubmit={handleVoice} />
      ) : (
        <TextInput question={stubQuestion} onSubmit={handleText} />
      )}
    </div>
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
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [phrasedForTTS, setPhrasedForTTS] = useState<string | null>(null);
  const [ttsDisplayText, setTtsDisplayText] = useState("");
  const [ttsDone, setTtsDone] = useState(false);

  // ── Preload cache ──
  const preloadCacheRef = useRef<Map<string, string>>(new Map());

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

  // Preload next question phrasing during reflection
  const preloadNextQuestion = useCallback(() => {
    const nextIdx = questionIndex + 1;
    if (nextIdx >= questions.length) return;
    const nextQ = questions[nextIdx];
    if (preloadCacheRef.current.has(nextQ.id)) return;

    fetch("/api/phrase-question", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question_prompt: nextQ.prompt,
        tone: form.tone,
        form_intent: form.intent,
        session_id: sessionId,
      }),
    })
      .then(async (res) => {
        if (!res.ok) return;
        const ct = res.headers.get("content-type") ?? "";
        if (ct.includes("application/json")) {
          const { phrased } = await res.json();
          if (phrased) {
            preloadCacheRef.current.set(nextQ.id, phrased);
            if (sessionId && typeof sessionStorage !== "undefined") {
              sessionStorage.setItem(`phrase:${sessionId}:${nextQ.id}`, phrased);
            }
          }
        }
      })
      .catch(() => {});
  }, [questionIndex, questions, form.tone, form.intent, sessionId]);

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
    setAvatarMode("thinking");
    setStage("QUESTION");
  }

  function advanceQuestion() {
    playTick();
    if (nullReflectionTimerRef.current) {
      clearTimeout(nullReflectionTimerRef.current);
      nullReflectionTimerRef.current = null;
    }
    setPhrasedForTTS(null);
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
    if (sessionId && currentQuestion) {
      try {
        await fetchWithRetry(
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
      } catch {
        toast.error("Connection hiccup, please try again");
      }
    }
    goToReflection(
      pendingReflectionRef.current,
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
        aria-label={muted ? "Unmute voice" : "Mute voice"}
      >
        {muted ? (
          <VolumeX className="h-4 w-4 text-muted-foreground" />
        ) : (
          <Volume2 className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

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
        {phrasedForTTS && stage === "QUESTION" && (
          <div className="relative z-10 pb-2 md:pb-8 flex justify-center">
            <TTSPlayer
              key={`tts-${questionIndex}`}
              text={phrasedForTTS}
              tone={form.tone}
              muted={muted}
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
                onPhrasedReady={setPhrasedForTTS}
                ttsDisplayText={ttsDisplayText}
                ttsDone={ttsDone}
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
                onAnswer={handleFollowUpAnswer}
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
