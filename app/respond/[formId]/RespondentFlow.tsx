"use client";

import Image from "next/image";
import { useState, useEffect, useRef, useCallback } from "react";
import { AnimatePresence, motion, type Variants } from "framer-motion";
import { Volume2, VolumeX } from "lucide-react";
import { toast } from "sonner";
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
    <div className="relative flex h-full w-full -translate-y-6 flex-col gap-6 p-5 md:-translate-y-8 md:flex-row md:p-8">
      <div className="flex w-full items-center px-8 pt-16 md:w-[55%] md:px-14 md:pt-0">
        <div className="flex flex-col items-start gap-7">
          <h1 className="font-display max-w-2xl text-[2.625rem] leading-tight tracking-tight text-white md:text-[3.375rem]">
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
          className="font-matter w-full border-0 bg-transparent px-0 py-4 text-center text-[2.4rem] font-medium leading-tight text-transparent caret-transparent outline-none disabled:cursor-not-allowed md:text-[3.25rem]"
          maxLength={30}
        />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-0 py-4">
          <span
            className={`font-matter text-[2.4rem] font-medium leading-tight md:text-[3.25rem] ${
              name ? "text-foreground" : "text-foreground/25"
            }`}
          >
            {name || "Your Name"}
          </span>
          <motion.span
            className="ml-2 h-[2.4rem] w-[5px] rounded-full bg-[#ff4d00] md:h-[3.25rem] md:w-[6px]"
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
                className="group relative isolate h-16 overflow-hidden rounded-[999px] bg-[#111820] px-12 text-xl font-medium text-white shadow-none transition-transform hover:scale-[1.03] hover:bg-[#0b1118] hover:text-white disabled:opacity-45"
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
  splitLayout = false,
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
  splitLayout?: boolean;
}) {
  const { input_type, options } = question;
  // These props remain on the API but are no longer used inside QuestionStage
  // after Phase 2.5 moved phrase fetching to the parent's preload pipeline.
  // Marking as intentional-unused to silence lint without changing the call-site
  // contract.
  void sessionId;
  void tone;
  void formIntent;
  void respondentName;
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
  const typewriterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ttsFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stable ref for onPhrasedReady so the trigger effects don't re-run on re-renders
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

  /**
   * Hand a phrased text (and optional preloaded audio URL) to the parent's
   * TTS pipeline AND seed the local typewriter state. After Phase 2.5's
   * preload pipeline took over phrase fetching, this is the only way the
   * QuestionStage publishes a question's phrasing — there is no in-component
   * fetch anymore. Idempotency is provided by the callers (the main + watcher
   * effects guard on `pendingTypewriterText` / `question.input_type`).
   */
  function queueForTtsThenType(text: string, audioUrl?: string | null) {
    onPhrasedReadyRef.current(text, audioUrl);
    setPendingTypewriterText(text);
    if (ttsFallbackTimerRef.current) clearTimeout(ttsFallbackTimerRef.current);
    ttsFallbackTimerRef.current = setTimeout(() => {
      if (!typingActiveRef.current) startTypewriterWithText(text);
    }, 5000);
  }

  // Main per-question effect — only runs when the question changes. Resets
  // local typewriter state and, if the phrasing is already known at mount
  // time, fires queueForTtsThenType immediately. Otherwise the watcher
  // effect below picks it up when `preloaded` lands.
  useEffect(() => {
    if (typewriterTimerRef.current) clearTimeout(typewriterTimerRef.current);
    if (inputTimerRef.current) clearTimeout(inputTimerRef.current);
    if (ttsFallbackTimerRef.current) clearTimeout(ttsFallbackTimerRef.current);
    charQueueRef.current = [];
    displayedRef.current = "";
    typingActiveRef.current = false;
    streamDoneRef.current = false;

    setPhrased(null);
    setThinking(true);
    setInputReady(false);
    setPendingTypewriterText(null);

    if (question.input_type === "name") {
      // Name question — phrasing is the constant from the schema layer; no
      // preload involved. Audio URL is left blank so TTSPlayer fetches it.
      queueForTtsThenType(NAME_QUESTION_PROMPT);
    } else if (preloaded) {
      // Preload was already populated by the parent before we mounted.
      queueForTtsThenType(preloaded.phrased, preloaded.audioUrl);
    } else if (question.position === -1) {
      // Follow-up stub (FollowUpStage uses position -1). The follow-up
      // endpoint already returns tone-aware prompt text; treat it as the
      // phrasing directly. No preload is ever produced for follow-ups.
      queueForTtsThenType(question.prompt);
    }
    // Otherwise: wait for the watcher below to fire when `preloaded` lands.
    // No fetch is performed here — Phase 2.5's preload pipeline owns that.

    return () => {
      if (typewriterTimerRef.current) clearTimeout(typewriterTimerRef.current);
      if (inputTimerRef.current) clearTimeout(inputTimerRef.current);
      if (ttsFallbackTimerRef.current) clearTimeout(ttsFallbackTimerRef.current);
    };
  // sessionId / respondentName / tone / formIntent intentionally omitted —
  // the trigger is question identity; other context flows through props
  // and is read at use-time via refs/closures of the helpers above.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question.id]);

  // Watcher: fires when `preloaded` flips from null → populated AFTER the
  // QuestionStage mounted (the parent's preloadCacheRef-to-state sync runs
  // one render late on questionIndex change). Idempotent via the
  // `pendingTypewriterText` guard so a same-mount preload doesn't double-fire.
  useEffect(() => {
    if (!preloaded) return;
    if (question.input_type === "name") return;
    if (pendingTypewriterText) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    queueForTtsThenType(preloaded.phrased, preloaded.audioUrl);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preloaded?.phrased, preloaded?.audioUrl, question.id]);

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

  const inputDisabled = !ttsDone;
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
      {thinking ? (
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
              ? "font-display text-[2.625rem] leading-tight tracking-tight text-white md:text-[3.375rem]"
              : "text-2xl font-medium leading-snug"
          }
        >
          {phrased ?? question.prompt}
        </motion.h2>
      )}
    </AnimatePresence>
  );

  if (splitLayout) {
    return (
      <div className="flex min-h-screen w-full -translate-y-6 flex-col gap-6 p-4 md:-translate-y-8 md:flex-row md:p-4">
        <div className="flex w-full items-center px-8 pt-16 md:w-[55%] md:px-14 md:pt-0">
          <div className="max-w-2xl text-left">{promptArea}</div>
        </div>
        <div className="flex w-full items-center justify-center md:w-[45%]">
          <AnimatePresence>
            {inputReady && (
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
            )}
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

      <AnimatePresence>
        {inputReady && (
          <motion.div
            key="input-area"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" as const }}
          >
            {inputArea}
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
  splitLayout,
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
  splitLayout?: boolean;
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
      splitLayout={splitLayout}
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
  const [preloadError, setPreloadError] = useState(false);

  // ── Preload cache ──
  const preloadCacheRef = useRef<Map<string, PreloadItem>>(new Map());
  const preloadStartedRef = useRef(false);
  const preloadNameRef = useRef<string | null>(null);

  // Mirror of preloadCacheRef for the current question — ref is async-populated,
  // so we copy the relevant entry into state to keep render reactive.
  const [preloadedForCurrent, setPreloadedForCurrent] = useState<PreloadItem | null>(null);

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
      shaderMode = ttsDone ? "listening" : "speaking";
    } else {
      shaderMode = "listening";
    }
  }

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
    };
  }, []);

  // Sync the preload cache entry for the current question into state.
  // preloadProgress changes whenever the cache is written, so this stays current.
  useEffect(() => {
    const q = questions[questionIndex];
    if (!q) {
      setPreloadedForCurrent(null);
      return;
    }
    setPreloadedForCurrent(preloadCacheRef.current.get(q.id) ?? null);
  }, [questionIndex, preloadProgress, questions]);

  // Kick off background pre-load of Q2..Qn when QUESTION stage first mounts.
  // Runs once (preloadAll guards against double-runs via preloadStartedRef).
  useEffect(() => {
    if (stage !== "QUESTION" || !sessionId || questionIndex !== 0) return;
    void preloadAll(sessionId, null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, sessionId, questionIndex]);

  // If preload lands for the current question before QuestionStage's live
  // fetch fires queueForTtsThenType, hand the cached blob URL to TTSPlayer
  // directly. This narrows the gesture-to-play window for anonymous Q1, where
  // the sequential phrase-fetch + tts-fetch path can otherwise exceed Chrome's
  // user-gesture autoplay tolerance.
  useEffect(() => {
    if (stage !== "QUESTION" || !preloadedForCurrent) return;
    if (phrasedForTTS) return;
    setPhrasedForTTS(preloadedForCurrent.phrased);
    setPreloadedAudioUrlForTTS(preloadedForCurrent.audioUrl);
  }, [stage, preloadedForCurrent, phrasedForTTS]);

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

    // Name question: capture locally, fire the answers POST (which mirrors to
    // sessions.respondent_name), then advance. No reflection, no follow-up.
    if (currentQuestion?.input_type === "name") {
      const value =
        typeof (rawValue as { value?: unknown })?.value === "string"
          ? ((rawValue as { value: string }).value).trim()
          : "";
      if (value) setRespondentNameSaved(value);
      if (sessionId && currentQuestion) {
        try {
          await fetch("/api/answers", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              session_id: sessionId,
              question_id: currentQuestion.id,
              raw_value: rawValue,
              transcript: null,
            }),
          });
        } catch {
          // Best-effort — name persistence is not blocking.
        }
      }
      advanceQuestion();
      return;
    }

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
    <div className="relative h-screen overflow-hidden">
      <div className="fixed inset-0 z-0 bg-[url('/bg-blue.png')] bg-cover bg-center" />
      <PresenceShader mode={shaderMode} className="fixed inset-0 z-0" />
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

      {phrasedForTTS && (stage === "QUESTION" || stage === "FOLLOWUP") && (
        <div className="fixed bottom-4 left-4 z-50">
          <TTSPlayer
            key={`tts-${stage}-${questionIndex}`}
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
                sessionId={sessionId}
                tone={form.tone}
                formIntent={form.intent}
                onAnswer={handleAnswer}
                onPhrasedReady={handlePhrasedReady}
                ttsDisplayText={ttsDisplayText}
                ttsDone={ttsDone}
                preloaded={preloadedForCurrent}
                respondentName={respondentNameSaved}
                splitLayout
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
                sessionId={sessionId}
                tone={form.tone}
                questionIntent={questions[questionIndex]?.intent ?? null}
                onAnswer={handleFollowUpAnswer}
                onPhrasedReady={handlePhrasedReady}
                ttsDisplayText={ttsDisplayText}
                ttsDone={ttsDone}
                respondentName={respondentNameSaved}
                splitLayout
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
                  tone={form.tone}
                  muted={muted}
                  onSpeakingChange={handleSpeakingChange}
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
