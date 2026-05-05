"use client";

import Image from "next/image";
import { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import { AnimatePresence, motion, type Variants } from "framer-motion";
import { Volume2, VolumeX } from "lucide-react";
import type { AvatarMode } from "@/components/AIPresence";
import { BackgroundMusic } from "@/components/BackgroundMusic";
import { PresenceShader, type PresenceShaderMode } from "@/components/PresenceShader";
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
import { CompleteStage, getCardPalette } from "@/components/CompleteStage";
import { playTick, playWhoosh, setSoundMuted } from "@/lib/sounds";
import type { Form, Question } from "@/lib/types";
import type { NullReflectionReason, ReflectionResult } from "@/lib/reflection";
import { NAME_QUESTION_PROMPT } from "@/lib/schemas";

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

// ─── Tone gradient config ────────────────────────────────────────────────────

const ENTRY_GRADIENT: Record<string, { from: string; to: string }> = {
  playful: { from: "rgba(249,115,22,0.10)", to: "rgba(236,72,153,0.06)" },
  calm: { from: "rgba(59,130,246,0.10)", to: "rgba(20,184,166,0.06)" },
  direct: { from: "rgba(156,163,175,0.08)", to: "rgba(75,85,99,0.04)" },
  insightful: { from: "rgba(139,92,246,0.10)", to: "rgba(99,102,241,0.06)" },
};

// ─── Reaction pop sub-component ──────────────────────────────────────────────

function ReactionPopEmoji({ emoji }: { emoji: string }) {
  // Position the pop once per mount. Using a state initializer (not a useRef
  // initialized with Math.random()) keeps the random call out of render and
  // satisfies the React-hooks lint rules.
  const [pos] = useState(() => ({
    left: `${15 + Math.random() * 70}%`,
    top: `${15 + Math.random() * 60}%`,
    drift: (Math.random() - 0.5) * 50,
  }));

  return (
    <motion.span
      className="absolute text-3xl pointer-events-none select-none z-20"
      style={{ left: pos.left, top: pos.top }}
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: [0, 1.4, 0], opacity: [0, 1, 0], x: pos.drift }}
      transition={{ duration: 1.2, ease: "easeOut" }}
    >
      {emoji}
    </motion.span>
  );
}

// ─── Entry screen ─────────────────────────────────────────────────────────────

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

function truncateWords(value: string, maxWords: number): string {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return value;
  return `${words.slice(0, maxWords).join(" ")}...`;
}

const ENTRY_QUOTE_LAYOUT = [
  { top: "15.2%", size: "clamp(0.54rem, 1.08vw, 1.12rem)", opacity: 0.1 },
  { top: "26%", size: "clamp(0.65rem, 1.3vw, 1.35rem)", opacity: 0.25 },
  { top: "37.2%", size: "clamp(0.76rem, 1.52vw, 1.58rem)", opacity: 0.5 },
  { top: "48.4%", size: "clamp(0.82rem, 1.62vw, 1.7rem)", opacity: 1 },
  { top: "61.2%", size: "clamp(0.76rem, 1.52vw, 1.58rem)", opacity: 0.5 },
  { top: "72.4%", size: "clamp(0.65rem, 1.3vw, 1.35rem)", opacity: 0.25 },
  { top: "84%", size: "clamp(0.54rem, 1.08vw, 1.12rem)", opacity: 0.1 },
];

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
  const [quoteCursor, setQuoteCursor] = useState(0);

  async function handleStart() {
    setStarting(true);
    await onStart().catch(() => setStarting(false));
  }

  const quoteLines = quotes.slice(-7).map((quote) => truncateWords(quote, 4));
  const quoteSource =
    quoteLines.length > 0
      ? quoteLines
      : [
          "Let's collaborate and create something amazing!",
          "Live in harmony.",
          "Embrace coexistence.",
          "Together in unity.",
          "Finding common ground.",
          "Living side by side.",
          "Building bridges, not walls.",
        ];
  const displayQuotes = ENTRY_QUOTE_LAYOUT.map((_, index) => {
    const sourceIndex = quoteCursor + index;
    return {
      id: sourceIndex,
      text: quoteSource[sourceIndex % quoteSource.length],
    };
  });

  useEffect(() => {
    if (quoteSource.length <= 1) return;
    const interval = setInterval(() => {
      setQuoteCursor((current) => current + 1);
    }, 2200);

    return () => clearInterval(interval);
  }, [quoteSource.length]);

  return (
    <div className="relative flex h-full w-full flex-col gap-6 p-5 md:-translate-y-8 md:flex-row md:p-8">
      <div className="flex w-full items-center px-4 pt-8 md:w-[55%] md:px-14 md:pt-0">
        <div className="flex flex-col items-start gap-7">
          <h1 className="font-display max-w-2xl text-[2rem] leading-tight tracking-tight text-white md:text-[3.375rem]">
            {form.title}
          </h1>
          <div className="flex flex-col items-start gap-4">
            <motion.div
              className="w-fit"
              animate={{ scale: [1, 1.04, 1] }}
              transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
            >
              <Button
                variant="ghost"
                size="lg"
                className="group relative isolate h-14 overflow-hidden rounded-[999px] border-0 bg-transparent px-10 text-lg text-white shadow-[0_18px_45px_rgba(4,12,28,0.34),inset_0_1px_0_rgba(255,255,255,0.36)] backdrop-blur-[24px] backdrop-saturate-150 hover:bg-transparent hover:text-white"
                onClick={handleStart}
                disabled={starting}
              >
                <span className="pointer-events-none absolute inset-0 rounded-[999px] bg-[linear-gradient(135deg,rgba(255,255,255,0.42)_0%,rgba(255,255,255,0.16)_34%,rgba(255,255,255,0.06)_58%,rgba(255,255,255,0.26)_100%)]" />
                <span className="pointer-events-none absolute inset-[1px] rounded-[999px] bg-[radial-gradient(circle_at_22%_12%,rgba(255,255,255,0.62),transparent_28%),radial-gradient(circle_at_85%_85%,rgba(125,191,255,0.22),transparent_34%)]" />
                <span className="pointer-events-none absolute -left-8 top-0 h-full w-20 -skew-x-12 bg-white/30 blur-xl transition-transform duration-700 group-hover:translate-x-64" />
                <span className="relative z-10 drop-shadow-[0_1px_8px_rgba(255,255,255,0.18)]">
                  {starting ? "Starting…" : "Let's start →"}
                </span>
              </Button>
            </motion.div>
          </div>
        </div>
      </div>

      <div className="flex w-full items-center justify-center md:w-[45%]">
        <div className="relative z-10 aspect-[400/250] w-full max-w-[560px] overflow-hidden rounded-[32px] bg-white text-black shadow-2xl">
          <AnimatePresence initial={false}>
            {displayQuotes.map((quote, index) => (
              <motion.p
                key={quote.id}
                className="font-matter absolute left-[6.75%] z-10 max-w-[58%] truncate whitespace-nowrap leading-none text-black"
                initial={{
                  top: "96%",
                  opacity: 0,
                  fontSize: ENTRY_QUOTE_LAYOUT[index].size,
                }}
                animate={{
                  top: ENTRY_QUOTE_LAYOUT[index].top,
                  opacity: ENTRY_QUOTE_LAYOUT[index].opacity,
                  fontSize: ENTRY_QUOTE_LAYOUT[index].size,
                }}
                exit={{
                  top: "4%",
                  opacity: 0,
                  transition: { duration: 0.45, ease: "easeIn" },
                }}
                transition={{ duration: 0.75, ease: "easeInOut" }}
              >
                &ldquo;{quote.text}&rdquo;
              </motion.p>
            ))}
          </AnimatePresence>

          <motion.div
            className="absolute left-[72.5%] top-[57.8%] z-20 h-[54.67%] w-[34.17%] cursor-pointer"
            whileHover={{ scale: 1.06, y: -4 }}
            transition={{ type: "spring", stiffness: 260, damping: 18 }}
          >
            <Image
              src="/pink-asset.png"
              alt=""
              fill
              sizes="300px"
              className="rotate-[10deg] object-contain"
              draggable={false}
            />
            <div className="absolute left-[24%] top-[34%] z-10 flex w-[52%] rotate-[10deg] flex-col items-center text-center text-white">
              <p className="font-display text-[clamp(1.08rem,2.7vw,3.4rem)] leading-none">
                {count}
              </p>
              <p className="text-[clamp(0.4rem,1vw,1.25rem)] leading-none">Responded</p>
            </div>
          </motion.div>

          <motion.div
            className="absolute left-[60.5%] top-[69.6%] z-30 h-[37.74%] w-[23.38%] cursor-pointer"
            whileHover={{ scale: 1.08, y: -5 }}
            transition={{ type: "spring", stiffness: 260, damping: 18 }}
          >
            <Image
              src="/green-asset.png"
              alt=""
              fill
              sizes="224px"
              className="object-contain"
              draggable={false}
            />
            <div className="absolute left-[22%] top-[26%] flex h-[48%] w-[56%] flex-col items-center justify-center text-center text-white">
              <p className="font-display text-[clamp(1.08rem,2.7vw,3.4rem)] leading-none">
                {reactionCount}
              </p>
              <p className="text-[clamp(0.4rem,1vw,1.25rem)] leading-none">Reactions</p>
            </div>
          </motion.div>

          <motion.div
            className="absolute left-[86%] top-[40%] z-10 h-[31%] w-[19%] cursor-pointer"
            whileHover={{ scale: 1.08, y: -4 }}
            transition={{ type: "spring", stiffness: 260, damping: 18 }}
          >
            <Image
              src="/blue-asset.png"
              alt=""
              fill
              sizes="152px"
              className="rotate-90 object-contain"
              draggable={false}
            />
            <div className="absolute left-[35%] top-[32%] flex w-[34%] flex-col items-center text-center text-white">
              <p className="font-display text-[clamp(0.93rem,2.33vw,2.9rem)] leading-none">3</p>
              <p className="text-[clamp(0.31rem,0.78vw,0.95rem)] leading-none">Mins</p>
            </div>
          </motion.div>
        </div>
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

// Name input rendered inside QuestionStage's white card when input_type === "name".
// Mirrors the typewriter-overlay aesthetic of the previous standalone NameCard,
// but lives inside the QuestionStage's own white card so it shares the layout.
function NameFieldInput({
  onSubmit,
  disabled,
}: {
  onSubmit: (value: string) => void;
  disabled: boolean;
}) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!disabled) inputRef.current?.focus();
  }, [disabled]);

  const error = name ? validateRespondentName(name) : "Tell us what to call you.";
  const valid = error === null;

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && valid && !disabled) {
      onSubmit(normalizeRespondentName(name));
    }
  }

  function handleClick() {
    if (!valid || disabled) return;
    onSubmit(normalizeRespondentName(name));
  }

  return (
    <div className="flex w-full flex-col items-center gap-6">
      <div className="relative w-full">
        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={handleKeyDown}
          aria-label="Your Name"
          disabled={disabled}
          className="font-matter w-full border-0 bg-transparent px-0 py-4 text-center text-[1.75rem] font-medium leading-tight text-transparent caret-transparent outline-none disabled:cursor-not-allowed md:text-[3.25rem]"
          maxLength={30}
        />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-0 py-4">
          <span
            className={`font-matter text-[1.75rem] font-medium leading-tight md:text-[3.25rem] ${
              name ? "text-foreground" : "text-foreground/25"
            }`}
          >
            {name || "Your Name"}
          </span>
          <motion.span
            className="ml-2 h-[1.75rem] w-[4px] rounded-full bg-[#ff4d00] md:h-[3.25rem] md:w-[6px]"
            animate={{ opacity: [0, 1, 1, 0] }}
            transition={{ duration: 1.05, repeat: Infinity, times: [0, 0.2, 0.72, 1] }}
          />
        </div>
        {name && error && (
          <p className="mt-2 text-center text-xs text-muted-foreground/70">{error}</p>
        )}
      </div>

      <AnimatePresence>
          {name.trim().length > 0 && (
            <motion.div
              className="w-fit"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
            >
              <Button
                variant="ghost"
                size="lg"
                className="group relative isolate h-12 overflow-hidden rounded-[999px] bg-[#111820] px-8 text-base font-medium text-white shadow-none transition-transform hover:scale-[1.03] hover:bg-[#0b1118] hover:text-white disabled:opacity-45 md:h-16 md:px-12 md:text-xl"
                onClick={handleClick}
                disabled={!valid || disabled}
              >
                <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_24%_12%,rgba(255,255,255,0.16),transparent_30%),linear-gradient(135deg,rgba(255,255,255,0.08),transparent_45%)]" />
                <span className="pointer-events-none absolute -left-20 top-0 h-full w-20 -skew-x-12 bg-white/30 blur-lg transition-transform duration-700 group-hover:translate-x-96" />
                <span className="relative z-10">Begin the conversation →</span>
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      {/* [ANON_SKIP_START] — remove this block with: sed -i '' '/\[ANON_SKIP_START\]/,/\[ANON_SKIP_END\]/d' "app/respond/[formId]/RespondentFlow.tsx" */}
      <motion.button
        type="button"
        disabled={disabled}
        onClick={() => { if (!disabled) onSubmit("Unnamed"); }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3 }}
        className="text-sm text-zinc-400 hover:text-zinc-600 transition-colors disabled:pointer-events-none"
      >
        stay anonymous →
      </motion.button>
      {/* [ANON_SKIP_END] */}
    </div>
  );
}

// ─── Question stage ───────────────────────────────────────────────────────────

const INPUT_REVEAL_DELAY_MS = 400;

function QuestionStage({
  question,
  index,
  total,
  onAnswer,
  displayText,
  ttsDone,
  showFallbackCopy,
  preamble,
  splitLayout = false,
  isAnswering = false,
}: {
  question: Question;
  index: number;
  total: number;
  onAnswer: (rawValue: unknown, transcript?: string) => void;
  displayText: string;
  ttsDone: boolean;
  showFallbackCopy: boolean;
  preamble?: string;
  splitLayout?: boolean;
  isAnswering?: boolean;
}) {
  const { input_type, options } = question;

  // Phase 6.5e: QuestionStage is a pure renderer. The parent owns all TTS
  // state (`displayText`, `ttsDone`, `showFallbackCopy`). We only own the
  // input-reveal timer — inputs unlock 400 ms after the parent signals
  // ttsDone (whether by audio ending or by the slow-TTS fallback).
  const [inputReady, setInputReady] = useState(false);
  const inputTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!ttsDone) {
      if (inputTimerRef.current) clearTimeout(inputTimerRef.current);
      setInputReady(false);
      return;
    }
    if (inputTimerRef.current) clearTimeout(inputTimerRef.current);
    inputTimerRef.current = setTimeout(
      () => setInputReady(true),
      INPUT_REVEAL_DELAY_MS
    );
    return () => {
      if (inputTimerRef.current) clearTimeout(inputTimerRef.current);
    };
  }, [ttsDone, question.id]);

  // Headline derivation — same three-state shape as Reflection:
  // 1. typewriter ticking → show what's revealed
  // 2. 3 s fallback fired → show full prompt
  // 3. otherwise → render <HeadlineLoader /> (parent's HeadlineLoader is in
  //    Reflection.tsx; we render the existing <ThinkingDots /> here for
  //    consistency with the prior question-stage thinking treatment)
  const isLoading = !displayText && !showFallbackCopy;
  const headlineText = displayText
    ? displayText
    : showFallbackCopy
      ? question.prompt
      : "";

  function handleVoice(v: { type: "voice"; value: string; audioBlob: Blob }) {
    onAnswer({ type: "voice", value: v.value }, v.value);
  }
  function handleText(v: { type: "text"; value: string }) {
    onAnswer(v);
  }
  function handleName(value: string) {
    onAnswer({ type: "name", value });
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

  const inputDisabled = !ttsDone || isAnswering;
  const inputArea = (
    <div
      className={`transition-opacity duration-200 ${
        inputDisabled ? "opacity-50" : "opacity-100"
      }`}
    >
      {input_type === "voice" && (
        <VoiceInput
          question={question}
          onSubmit={handleVoice}
          disabled={inputDisabled}
        />
      )}
      {input_type === "text" && (
        <TextInput
          question={question}
          onSubmit={handleText}
          disabled={inputDisabled}
        />
      )}
      {input_type === "emoji_slider" && (
        <EmojiSlider
          question={question}
          onSubmit={handleSlider}
          disabled={inputDisabled}
        />
      )}
      {input_type === "cards" && (
        <Cards
          question={question}
          options={parseStringOptions(options)}
          onSubmit={handleCards}
          disabled={inputDisabled}
        />
      )}
      {input_type === "ranking" && (
        <Ranking
          question={question}
          options={parseStringOptions(options)}
          onSubmit={handleRanking}
          disabled={inputDisabled}
        />
      )}
      {input_type === "this_or_that" && (
        <ThisOrThat
          question={question}
          options={parseStringOptions(options)}
          onSubmit={handleThisOrThat}
          disabled={inputDisabled}
        />
      )}
      {input_type === "visual_select" && (
        <VisualSelect
          question={question}
          options={parseVisualOptions(options)}
          onSubmit={handleVisual}
          disabled={inputDisabled}
        />
      )}
      {input_type === "name" && (
        <NameFieldInput onSubmit={handleName} disabled={inputDisabled} />
      )}
    </div>
  );

  const promptArea = (
    <AnimatePresence mode="popLayout">
      {isLoading ? (
        <motion.div
          key="thinking"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className={splitLayout ? "text-white" : undefined}
        >
          <ThinkingDots />
        </motion.div>
      ) : (
        <motion.h2
          key="prompt"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: "easeOut" as const }}
          className={
            splitLayout
              ? "font-display text-[1.875rem] leading-tight tracking-tight text-white md:text-[3.375rem]"
              : "text-2xl font-medium leading-snug"
          }
        >
          {headlineText}
        </motion.h2>
      )}
    </AnimatePresence>
  );

  if (splitLayout) {
    return (
      <div className="flex min-h-screen w-full flex-col gap-4 p-4 md:-translate-y-8 md:flex-row md:gap-6 md:p-4">
        <div className="flex w-full items-start px-4 pt-8 md:w-[55%] md:items-center md:px-14 md:pt-0">
          <div className="max-w-2xl text-left">{promptArea}</div>
        </div>
        <div className="flex w-full items-center justify-center pb-6 md:w-[45%] md:pb-0">
          <AnimatePresence mode="wait">
            {isAnswering ? (
              <motion.div
                key="answering"
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ duration: 0.2 }}
                className="w-full max-w-2xl rounded-3xl bg-white p-8 text-black shadow-2xl flex items-center justify-center min-h-[120px]"
              >
                <ThinkingDots />
              </motion.div>
            ) : inputReady ? (
              <motion.div
                key="input-card"
                initial={{ opacity: 0, y: 20, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.97 }}
                transition={{ duration: 0.45, ease: "easeOut" }}
                className={`w-full max-w-2xl rounded-3xl bg-white text-black shadow-2xl ${
                  question.input_type === "name"
                    ? "flex min-h-[240px] flex-col items-center justify-center p-8"
                    : "p-6"
                }`}
              >
                {inputArea}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 px-12 py-14 max-w-lg w-full">
      <p className="text-xs font-medium tracking-widest uppercase text-muted-foreground">
        {preamble ?? `${index + 1} / ${total}`}
      </p>

      {promptArea}

      <AnimatePresence mode="wait">
        {isAnswering ? (
          <motion.div
            key="answering"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <ThinkingDots />
          </motion.div>
        ) : inputReady ? (
          <motion.div
            key="input-area"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" as const }}
          >
            {inputArea}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

// ─── Follow-up stage ──────────────────────────────────────────────────────────

function FollowUpStage({
  prompt,
  inputType,
  questionIntent,
  onAnswer,
  displayText,
  ttsDone,
  showFallbackCopy,
  splitLayout,
  isAnswering,
}: {
  prompt: string;
  inputType: "voice" | "text";
  questionIntent: string | null;
  onAnswer: (rawValue: unknown, transcript?: string) => void;
  displayText: string;
  ttsDone: boolean;
  showFallbackCopy: boolean;
  splitLayout?: boolean;
  isAnswering?: boolean;
}) {
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
      onAnswer={onAnswer}
      displayText={displayText}
      ttsDone={ttsDone}
      showFallbackCopy={showFallbackCopy}
      preamble="One more thing…"
      splitLayout={splitLayout}
      isAnswering={isAnswering}
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
        className="text-white text-sm"
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

// ─── Fetch with timeout helper ────────────────────────────────────────────────
// IMPORTANT: we don't retry under concurrent load. Retries compound Sarvam
// rate-limit pressure and double the user's perceived latency. The /api/answers
// route inserts the answer to Supabase BEFORE the LLM calls — if the LLM phase
// fails, the data is already safe and we can advance with a null reflection.

async function fetchWithTimeout(
  url: string,
  opts: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
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
  const [respondentNameSaved, setRespondentNameSaved] = useState<string | null>(null);
  const [followUpPrompt, setFollowUpPrompt] = useState<string | null>(null);
  const [reflectionData, setReflectionData] = useState<ReflectionResult | null>(null);
  const [nullReason, setNullReason] = useState<NullReflectionReason | null>(null);
  const [nullDebugInfo, setNullDebugInfo] = useState<string | null>(null);
  const [avatarMode, setAvatarMode] = useState<AvatarMode>("idle");
  // True while /api/answers is in-flight — gives instant UI feedback on submit
  const [isAnswering, setIsAnswering] = useState(false);
  const pendingReflectionRef = useRef<ReflectionResult | null>(null);
  const pendingNullReasonRef = useRef<NullReflectionReason | null>(null);
  const pendingNullDebugInfoRef = useRef<string | null>(null);
  const reflectionHistoryRef = useRef<ReflectionResult["type"][]>([]);
  const nullReflectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Holds the deferred stage flip used by `goToReflection` and
  // `advanceQuestion`. Gives the outgoing stage's TTSPlayer ~500 ms to
  // unmount + pause its audio before the next stage's TTSPlayer mounts and
  // starts fetching.
  const stageTransitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── TTS state (Phase 6.5e: single narration state machine) ──
  // `narration` is the single source of truth for "what's currently being
  // narrated." A single TTSPlayer keyed on narration.id renders below; when
  // the id changes, the old TTSPlayer unmounts (audio paused + cleaned up)
  // and the new one mounts with fresh audio. No two TTSPlayers ever coexist.
  //
  // `narrationDisplayText` is updated by TTSPlayer per typewriter tick.
  // `narrationDone` flips true when audio ends (or errors, or fallback fires).
  // `showFallbackCopy` flips true at 3 s if displayText is still empty —
  // signals "TTS is too slow; render the full copy as a fallback."
  const [muted, setMuted] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("pulse-tts-muted") === "true";
  });
  const [musicActive, setMusicActive] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [narration, setNarration] = useState<{
    id: string;
    text: string;
    audioUrl: string | null;
  } | null>(null);
  const [narrationDisplayText, setNarrationDisplayText] = useState("");
  const [narrationDone, setNarrationDone] = useState(false);
  const [showFallbackCopy, setShowFallbackCopy] = useState(false);
  const narrationDisplayTextRef = useRef("");
  useEffect(() => {
    narrationDisplayTextRef.current = narrationDisplayText;
  }, [narrationDisplayText]);
  const [preloadProgress, setPreloadProgress] = useState(0);
  const [preloadError, setPreloadError] = useState(false);

  // ── Preload cache ──
  const preloadCacheRef = useRef<Map<string, PreloadItem>>(new Map());
  const preloadStartedRef = useRef(false);
  const preloadNameRef = useRef<string | null>(null);

  // (Phase 6.5e: preloadedForCurrent removed — narration is derived directly
  // from preloadCacheRef.current inside the narration effect.)

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

  const hasStarted = stage !== "ENTRY";
  let shaderMode: PresenceShaderMode = "static";
  if (hasStarted) {
    if (stage === "QUESTION" || stage === "FOLLOWUP") {
      shaderMode = narrationDone ? "listening" : "speaking";
    } else {
      shaderMode = "listening";
    }
  }

  // (Phase 6.5e: handlePhrasedReady removed — narration is parent-derived
  // from stage / question / preload via the effect above.)

  async function preloadQuestion(
    q: Question,
    activeSessionId: string,
    activeName: string | null,
    onAssetDone: () => void
  ) {
    // Name questions don't need phrase-rephrasing; the constant is already on hand.
    let text: string;
    if (q.input_type === "name") {
      text = NAME_QUESTION_PROMPT;
    } else {
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
          input_type: q.input_type,
        }),
      });
      const { phrased } = (await phraseRes.json()) as { phrased?: string };
      text = phrased || q.prompt;
    }
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

    // Skip the name question (constant phrasing, no value to preload). Pre-load
    // every other question, including Q1 in anonymous mode so its TTS audio is
    // ready by the time the audio element starts playing — otherwise the
    // sequential phrase-fetch + tts-fetch round trip can exceed the browser's
    // user-gesture autoplay window and the audio gets silently blocked.
    const targets = questions.filter((q) => q.input_type !== "name");
    if (targets.length === 0) {
      setPreloadProgress(1);
      return;
    }

    let completed = 0;
    const total = targets.length * 2;
    const markDone = () => {
      completed += 1;
      setPreloadProgress(Math.min(1, completed / total));
    };

    const results = await Promise.allSettled(
      targets.map((q) => preloadQuestion(q, activeSessionId, activeName, markDone))
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
      if (stageTransitionTimerRef.current) {
        clearTimeout(stageTransitionTimerRef.current);
        stageTransitionTimerRef.current = null;
      }
      if (nullReflectionTimerRef.current) {
        clearTimeout(nullReflectionTimerRef.current);
        nullReflectionTimerRef.current = null;
      }
    };
  }, []);

  // Kick off background pre-load of Q2..Qn when QUESTION stage first mounts.
  // Runs once (preloadAll guards against double-runs via preloadStartedRef).
  useEffect(() => {
    if (stage !== "QUESTION" || !sessionId || questionIndex !== 0) return;
    void preloadAll(sessionId, null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, sessionId, questionIndex]);

  // ── Phase 6.5e: derive narration from stage / question / reflection / preload ──
  // Single source of truth for "what's being narrated right now." Whenever
  // any of the inputs change, this effect computes the next narration and
  // sets it. The TTSPlayer's `key` is `narration?.id`, so when it changes the
  // old TTSPlayer unmounts (audio paused + cleaned up) and the new one
  // mounts. State machine, not procedural.
  useEffect(() => {
    let next: { id: string; text: string; audioUrl: string | null } | null = null;

    if (stage === "QUESTION" && questions[questionIndex]) {
      const q = questions[questionIndex];
      if (q.input_type === "name") {
        next = { id: `Q-${q.id}`, text: NAME_QUESTION_PROMPT, audioUrl: null };
      } else {
        const cached = preloadCacheRef.current.get(q.id);
        if (cached) {
          next = { id: `Q-${q.id}`, text: cached.phrased, audioUrl: cached.audioUrl };
        } else {
          // Preload hasn't finished (or failed). Show the raw prompt with no
          // audio so the user can read + answer immediately. Without this
          // fallback the narration stayed null and the question card showed
          // ThinkingDots forever — user reported "stuck after name" because
          // Q2's preload races against the now-instant name submit.
          // Same id as the cached branch so the dedup updater below keeps
          // this raw version even if the cache fills mid-display (no
          // mid-typing flicker / TTSPlayer remount).
          next = { id: `Q-${q.id}`, text: q.prompt, audioUrl: null };
        }
      }
    } else if (stage === "FOLLOWUP" && followUpPrompt) {
      const qid = questions[questionIndex]?.id ?? "x";
      next = { id: `F-${qid}-${followUpPrompt.length}`, text: followUpPrompt, audioUrl: null };
    } else if (stage === "REFLECTION" && reflectionData) {
      const qid = questions[questionIndex]?.id ?? "x";
      next = { id: `R-${qid}`, text: reflectionData.copy, audioUrl: null };
    }

    // Pure updater: returns prev when ids match (TTSPlayer stays mounted) and
    // returns next otherwise. Display-state reset is handled by the
    // useLayoutEffect below — keeping the updater pure avoids React 18's
    // double-invocation in Strict Mode firing the inner setStates twice and
    // racing against typewriter ticks.
    setNarration((prev) => (prev?.id === next?.id ? prev : next));
  }, [stage, questionIndex, questions, followUpPrompt, reflectionData, preloadProgress]);

  // Reset display state SYNCHRONOUSLY before the browser paints whenever the
  // narration id changes. useLayoutEffect (not useEffect) so the reset commits
  // in the same paint as the new narration object — there's no intermediate
  // frame where the new TTSPlayer is mounted but `narrationDisplayText` still
  // holds the previous narration's full text. That intermediate frame was the
  // visible "text goes back" flicker.
  useLayoutEffect(() => {
    setNarrationDisplayText("");
    setNarrationDone(false);
    setShowFallbackCopy(false);
  }, [narration?.id]);

  // Slow-TTS fallback: if the typewriter hasn't started ticking within 3 s of
  // a new narration, surface the full copy + unblock UI. Single timer keyed
  // on narration.id; cleared on narration change or unmount.
  useEffect(() => {
    if (!narration) return;
    const t = setTimeout(() => {
      // Only fire if typewriter still hasn't started. Use the ref to read the
      // latest displayText without making it a dep (which would re-fire the
      // effect on every typewriter tick).
      if (narrationDisplayTextRef.current) return;
      setShowFallbackCopy(true);
      setNarrationDone(true);
    }, 3000);
    return () => clearTimeout(t);
  }, [narration?.id]);

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
    if (stage === "QUESTION" && !narration && !isSpeaking) {
      setAvatarMode("thinking");
    } else if (stage === "ENTRY" || stage === "COMPLETE") {
      setAvatarMode("idle");
    }
  }, [stage, narration, isSpeaking]);

  async function handleStart() {
    playTick();
    setMusicActive(true);

    // Request mic permission early so the first voice question doesn't surprise
    // the user with a permission prompt mid-flow. Denial is non-blocking — voice
    // inputs already fall back to "tap to type instead".
    if (typeof navigator !== "undefined" && navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
      } catch {
        // User denied or device unavailable — continue regardless.
      }
    }

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
    if (stageTransitionTimerRef.current) {
      clearTimeout(stageTransitionTimerRef.current);
    }
    setReflectionData(null);
    setNullReason(null);
    setNullDebugInfo(null);
    pendingReflectionRef.current = null;
    pendingNullReasonRef.current = null;
    pendingNullDebugInfoRef.current = null;
    setIsSpeaking(false);
    setIsAnswering(false);
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
    setIsAnswering(true);

    // Name question: capture locally and advance INSTANTLY. The /api/answers
    // POST runs fire-and-forget in the background so a slow Vercel cold-start
    // or transient Supabase blip never traps the user on the loading screen.
    // The server-side handler short-circuits name questions (DB insert +
    // sessions.respondent_name update, no LLM) so it's safe to not await.
    if (currentQuestion?.input_type === "name") {
      const value =
        typeof (rawValue as { value?: unknown })?.value === "string"
          ? ((rawValue as { value: string }).value).trim()
          : "";
      if (value) setRespondentNameSaved(value);
      if (sessionId && currentQuestion) {
        // Fire-and-forget; 5s safety timeout so a stuck request doesn't leak
        // resources but it never blocks the UI (no `await`).
        void fetchWithTimeout(
          "/api/answers",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              session_id: sessionId,
              question_id: currentQuestion.id,
              raw_value: rawValue,
              transcript: null,
            }),
          },
          5000
        ).catch(() => {
          // Best-effort — name persistence isn't blocking. Worst case we lose
          // the name on this respondent's session row (rare, recoverable via
          // /api/answers retries from the next question's flow).
        });
      }
      advanceQuestion();
      return;
    }

    // ── Optimistic flow: fire both /api/answers and /api/follow-up in parallel,
    //    race against a 1.5s budget. If they land in time, show the reflection
    //    or transition to follow-up. If not, advance to next question with no
    //    reflection — the user never waits more than 1.5s on the question card.
    //    The answer is still saved (server-side insert happens in Phase 1 of
    //    /api/answers regardless of how long the LLM phase takes).

    const eligibleForFollowUp =
      currentQuestion?.follow_up_enabled &&
      (currentQuestion.input_type === "voice" ||
        currentQuestion.input_type === "text") &&
      typeof transcript === "string" &&
      transcript.trim().length > 0;

    type AnswersResp = {
      reflection?: ReflectionResult | null;
      null_reason?: NullReflectionReason | null;
      debug_info?: string | null;
    };
    type FollowUpResp = { follow_up?: string | null };

    const answersPromise: Promise<AnswersResp | null> =
      sessionId && currentQuestion
        ? fetchWithTimeout(
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
            8000
          )
            .then((res) => (res.ok ? (res.json() as Promise<AnswersResp>) : null))
            .catch(() => null)
        : Promise.resolve(null);

    const followUpPromise: Promise<FollowUpResp | null> = eligibleForFollowUp
      ? fetchWithTimeout(
          "/api/follow-up",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              question_prompt: currentQuestion.prompt,
              question_intent: currentQuestion.intent,
              answer_text: transcript,
              tone: form.tone,
            }),
          },
          3000
        )
          .then((res) => (res.ok ? (res.json() as Promise<FollowUpResp>) : null))
          .catch(() => null)
      : Promise.resolve(null);

    const wonInBudget = await Promise.race([
      Promise.all([answersPromise, followUpPromise]).then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 1500)),
    ]);

    if (wonInBudget) {
      const [answersData, followUpData] = await Promise.all([
        answersPromise,
        followUpPromise,
      ]);

      let reflection: ReflectionResult | null = null;
      if (answersData) {
        reflection = (answersData.reflection as ReflectionResult) ?? null;
        if (reflection?.type) {
          reflectionHistoryRef.current = [
            ...reflectionHistoryRef.current.slice(-5),
            reflection.type,
          ];
        }
        pendingNullReasonRef.current = answersData.null_reason ?? null;
        pendingNullDebugInfoRef.current = answersData.debug_info ?? null;
      }

      if (followUpData?.follow_up) {
        pendingReflectionRef.current = reflection;
        setFollowUpPrompt(followUpData.follow_up);
        setIsSpeaking(false);
        setIsAnswering(false);
        setAvatarMode("thinking");
        playTick();
        setStage("FOLLOWUP");
        return;
      }

      goToReflection(
        reflection,
        pendingNullReasonRef.current,
        pendingNullDebugInfoRef.current
      );
    } else {
      // Budget exceeded — advance immediately. Promises keep running in the
      // background (the answer save will still complete server-side); we just
      // don't surface their reflection / follow-up to the user. Better than
      // making them stare at thinking dots.
      console.warn("[handleAnswer] 1.5s budget exceeded, advancing without reflection");
      goToReflection(null, null, null);
    }
  }

  async function handleFollowUpAnswer(rawValue: unknown, transcript?: string) {
    const currentQuestion = questions[questionIndex];

    // INSTANT advance — the follow-up reuses the original answer's pending
    // reflection (already computed when the user submitted the parent
    // question). The follow-up itself is just additional context for analytics
    // and doesn't need its own reflection round-trip. Saves ~3-7s of wait
    // time the user previously stared at thinking dots for, with zero UX loss.
    goToReflection(
      pendingReflectionRef.current,
      pendingNullReasonRef.current,
      pendingNullDebugInfoRef.current
    );

    // Fire-and-forget save. Best-effort: failures only cost analytics
    // granularity for this follow-up answer; the user already moved on.
    if (sessionId && currentQuestion) {
      fetchWithTimeout(
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
        15000
      ).catch((err) => {
        console.warn("[handleFollowUpAnswer] background save failed:", err);
      });
    }
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
    setFollowUpPrompt(null);
    setIsSpeaking(false);
    setAvatarMode("idle");
    setIsAnswering(false);
    if (ref) playWhoosh();
    playTick();
    if (stageTransitionTimerRef.current) {
      clearTimeout(stageTransitionTimerRef.current);
    }
    setReflectionData(ref);
    setNullReason(ref ? null : reason ?? null);
    setNullDebugInfo(ref ? null : debugInfo ?? null);
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
    <div className="relative h-screen overflow-hidden">
      <div className="fixed inset-0 z-0 bg-[url('/bg-blue.png')] bg-cover bg-center" />
      <PresenceShader mode={shaderMode} className="fixed inset-0 z-0" image={form.appearance ?? "/paper-image.jpg"} />
      {/* Cover the blue shader on the complete screen — solid color from round-robin palette */}
      {stage === "COMPLETE" && (
        <div
          className="fixed inset-0 z-[1]"
          style={{ background: getCardPalette(sessionId).colorBack }}
        />
      )}
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

      {/* Phase 6.5e: ONE TTSPlayer for the whole flow. Keyed on narration.id —
          when the id changes (stage / question / reflection / followup), the
          old TTSPlayer unmounts (its cleanup pauses audio + clears src) and
          the new one mounts atomically. No two players ever coexist. */}
      {narration && (
        <div className="fixed bottom-4 left-4 z-50">
          <TTSPlayer
            key={narration.id}
            text={narration.text}
            tone={form.tone}
            muted={muted}
            preloadedAudioUrl={narration.audioUrl}
            onSpeakingChange={handleSpeakingChange}
            onDisplayedTextChange={(text, isDone) => {
              setNarrationDisplayText(text);
              if (isDone) setNarrationDone(true);
            }}
          />
        </div>
      )}

      {/* ── Left panel placeholder: kept hidden in the current design ──
          Previously rendered an AIPresence avatar + a slow-breathing motion
          tint. The whole panel is `display: none` so framer-motion was
          calculating keyframes for nothing. The block is left here (with no
          children) as a marker for the eventual paper-shader avatar. */}
      <div className="hidden" />

      {/* ── Right: human expression (60% desktop, rest mobile) ── */}
      <div
        className={
          stage === "QUESTION"
            ? "relative z-10 flex h-full w-full flex-1 items-stretch justify-stretch overflow-hidden"
            : "relative z-10 flex h-full w-full flex-1 items-center justify-center overflow-hidden"
        }
      >
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
              className="w-full h-full"
            >
              <QuestionStage
                question={questions[questionIndex]}
                index={questionIndex}
                total={questions.length}
                onAnswer={handleAnswer}
                displayText={narrationDisplayText}
                ttsDone={narrationDone}
                showFallbackCopy={showFallbackCopy}
                splitLayout
                isAnswering={isAnswering}
              />
            </motion.div>
          )}

          {stage === "FOLLOWUP" && followUpPrompt && (
            <motion.div key="followup" {...fadeUp} className="w-full h-full">
              <FollowUpStage
                prompt={followUpPrompt}
                inputType={
                  questions[questionIndex]?.input_type === "voice"
                    ? "voice"
                    : "text"
                }
                questionIntent={questions[questionIndex]?.intent ?? null}
                onAnswer={handleFollowUpAnswer}
                displayText={narrationDisplayText}
                ttsDone={narrationDone}
                showFallbackCopy={showFallbackCopy}
                splitLayout
                isAnswering={isAnswering}
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
                  splitLayout
                  displayText={narrationDisplayText}
                  ttsDone={narrationDone}
                  showFallbackCopy={showFallbackCopy}
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
            <motion.div key="complete" {...fadeUp} className="flex h-full w-full items-center justify-center">
              <CompleteStage form={form} sessionId={sessionId} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
