"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { motion } from "framer-motion";
import Lottie from "lottie-react";
import { ReflectionDistribution } from "@/components/reflection/ReflectionDistribution";
import { ReflectionSlider } from "@/components/reflection/ReflectionSlider";
import { ReflectionTribe } from "@/components/reflection/ReflectionTribe";
import type { ReflectionType } from "@/lib/reflection";
import type { InputType } from "@/lib/types";

// ── Props ────────────────────────────────────────────────────────────────────
// Phase 6.5e refactor: Reflection is a pure renderer. All TTS state lives in
// the parent (RespondentFlow's narration state machine). The single TTSPlayer
// at the parent level drives `displayText` / `ttsDone` / `showFallbackCopy`,
// and Reflection just reads them.

interface ReflectionProps {
  reflection: {
    type: ReflectionType;
    copy: string;
    payload: Record<string, unknown>;
    source?: "llm" | "fallback";
  };
  sessionId: string | null;
  questionId: string;
  questionInputType?: InputType;
  splitLayout?: boolean;
  /** Typewriter-revealed text from the parent's narration. Empty until TTS ticks. */
  displayText: string;
  /** Whether TTS playback (or the slow-TTS fallback) has finished. Gates Continue. */
  ttsDone: boolean;
  /** Set by the parent at 3 s if `displayText` is still empty (slow-TTS fallback). */
  showFallbackCopy: boolean;
  onDone: () => void;
}

// ── Constants ────────────────────────────────────────────────────────────────

const REACTIONS = [
  { key: "love",      emoji: "❤️", hex: "2764_fe0f" },
  { key: "fire",      emoji: "🔥", hex: "1f525"     },
  { key: "hundred",   emoji: "💯", hex: "1f4af"     },
  { key: "thumbsup",  emoji: "👍", hex: "1f44d"     },
  { key: "mindblown", emoji: "🤯", hex: "1f92f"     },
] as const;

function notoUrl(hex: string) {
  return `https://fonts.gstatic.com/s/e/notoemoji/latest/${hex}/lottie.json`;
}

// Continue button shows up this many ms after TTS finishes. Replaces the
// pre-TTS arbitrary 5s reveal timer.
const CONTINUE_AFTER_TTS_MS = 1000;
// (FALLBACK_COPY_DELAY_MS lives in RespondentFlow now — narration is parent-owned.)

// ── Headline loader ──────────────────────────────────────────────────────────
// Three pulsing dots rendered inline in the headline area while we wait for
// TTS to start ticking. Tells the user "headline is coming" so the supporting
// elements (right card, emoji bar) don't read as appearing first.

function HeadlineLoader() {
  return (
    <span aria-label="Loading" className="inline-flex items-baseline gap-3 align-middle">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="inline-block leading-none text-white/55"
          animate={{ opacity: [0.25, 1, 0.25] }}
          transition={{
            duration: 1.2,
            repeat: Infinity,
            delay: i * 0.3,
            ease: "easeInOut",
          }}
        >
          •
        </motion.span>
      ))}
    </span>
  );
}

const CIRCLE_R = 44;
const CIRCLE_C = 2 * Math.PI * CIRCLE_R;

// ── CountUp ──────────────────────────────────────────────────────────────────

function CountUp({ to, duration = 400 }: { to: number; duration?: number }) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    const start = performance.now();
    let raf: number;
    function tick(now: number) {
      const t = Math.min(1, (now - start) / duration);
      setVal(Math.round(t * to));
      if (t < 1) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, duration]);
  return <>{val}</>;
}

// ── Comparison: horizontal bar with glowing dot at percentile ────────────────

function ComparisonVisual({ payload }: { payload: Record<string, unknown> }) {
  const pct = (payload.percentile as number) ?? 50;
  const rounded = Math.round(pct);

  return (
    <div className="w-full max-w-sm mx-auto">
      {/* Mono caption */}
      <p className="text-center font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground/55">
        Where you land
      </p>

      {/* Big Seasons display number */}
      <motion.p
        className="mb-7 mt-2 text-center font-display text-[52px] leading-none tracking-tight text-foreground/85"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25, duration: 0.3 }}
      >
        {rounded}
      </motion.p>

      <div className="relative">
        {/* Track */}
        <div className="relative h-2.5 overflow-hidden rounded-full bg-zinc-200/60">
          {/* Filled gradient — matches question-1 loader: violet-300 → foreground/80 → blue-300 */}
          <motion.div
            className="absolute inset-0"
            initial={{ clipPath: "inset(0 100% 0 0)" }}
            animate={{ clipPath: `inset(0 ${100 - pct}% 0 0)` }}
            transition={{ duration: 0.75, ease: "easeOut" }}
            style={{
              background:
                "linear-gradient(to right, #c4b5fd 0%, rgba(24,24,27,0.78) 50%, #93c5fd 100%)",
            }}
          />
        </div>

        {/* Dot positioned over the bar */}
        <motion.div
          className="absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full"
          style={{
            left: `${pct}%`,
            marginLeft: -10,
            background:
              "radial-gradient(circle at 35% 30%, #ffffff 0%, #d8d4ee 60%, #93c5fd 100%)",
            boxShadow:
              "0 0 18px 4px rgba(196,181,253,0.5), 0 0 5px rgba(147,197,253,0.55)",
          }}
          initial={{ opacity: 0, scale: 0 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.55, duration: 0.3, type: "spring", bounce: 0.45 }}
        />
      </div>

      <div className="mt-3 flex justify-between font-mono text-[10px] tracking-wider text-muted-foreground/40">
        <span>0</span>
        <span>100</span>
      </div>
    </div>
  );
}

// ── Majority: soft circle filling up ─────────────────────────────────────────

function MajorityVisual({ payload }: { payload: Record<string, unknown> }) {
  const pct = (payload.chosenPct as number) ?? 0;
  const offset = CIRCLE_C - (CIRCLE_C * pct) / 100;

  return (
    <div className="relative w-28 h-28 mx-auto">
      <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
        <circle
          cx="50"
          cy="50"
          r={CIRCLE_R}
          fill="none"
          stroke="currentColor"
          strokeWidth="5"
          className="text-muted/20"
        />
        <motion.circle
          cx="50"
          cy="50"
          r={CIRCLE_R}
          fill="none"
          stroke="url(#grad-majority)"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={CIRCLE_C}
          initial={{ strokeDashoffset: CIRCLE_C }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        />
        <defs>
          <linearGradient id="grad-majority" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#3b82f6" />
            <stop offset="100%" stopColor="#06b6d4" />
          </linearGradient>
        </defs>
      </svg>
      <motion.span
        className="absolute inset-0 flex items-center justify-center text-2xl font-bold tabular-nums"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.15, duration: 0.2 }}
      >
        <CountUp to={pct} />%
      </motion.span>
    </div>
  );
}

// ── Minority: purple circle with "Rare" badge ────────────────────────────────

function MinorityVisual({ payload }: { payload: Record<string, unknown> }) {
  const pct = (payload.chosenPct as number) ?? 0;
  const offset = CIRCLE_C - (CIRCLE_C * pct) / 100;

  return (
    <div className="relative w-28 h-28 mx-auto">
      <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
        <circle
          cx="50"
          cy="50"
          r={CIRCLE_R}
          fill="none"
          stroke="currentColor"
          strokeWidth="5"
          className="text-muted/20"
        />
        <motion.circle
          cx="50"
          cy="50"
          r={CIRCLE_R}
          fill="none"
          stroke="url(#grad-minority)"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={CIRCLE_C}
          initial={{ strokeDashoffset: CIRCLE_C }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        />
        <defs>
          <linearGradient id="grad-minority" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#7c3aed" />
            <stop offset="100%" stopColor="#a855f7" />
          </linearGradient>
        </defs>
      </svg>
      <motion.span
        className="absolute inset-0 flex items-center justify-center text-2xl font-bold tabular-nums text-violet-300"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.15, duration: 0.2 }}
      >
        <CountUp to={pct} />%
      </motion.span>
      {/* Rare badge */}
      <motion.span
        className="absolute -bottom-3 left-1/2 -translate-x-1/2 bg-violet-600 text-white text-[10px] font-bold uppercase tracking-widest px-3 py-0.5 rounded-full"
        initial={{ opacity: 0, y: 6, scale: 0.8 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ delay: 0.4, duration: 0.2, type: "spring", bounce: 0.4 }}
      >
        Rare
      </motion.span>
    </div>
  );
}

// ── Tribe: letter-by-letter label with particle dots ─────────────────────────

function TribeVisual({ payload }: { payload: Record<string, unknown> }) {
  const label =
    (payload.clusterLabelHumanized as string) ??
    (payload.clusterLabel as string) ??
    "";
  const count = (payload.clusterCount as number) ?? 0;

  const particles = useMemo(() => {
    const n = Math.min(count, 24);
    return Array.from({ length: n }, (_, i) => {
      const angle = (i / n) * Math.PI * 2;
      const ring = 30 + (i % 3) * 12;
      return {
        x: Math.cos(angle) * ring,
        y: Math.sin(angle) * ring * 0.65,
        delay: 0.12 + i * 0.02,
        size: 3 + (i % 3),
      };
    });
  }, [count]);

  return (
    <div className="relative flex flex-col items-center">
      <div className="relative w-56 h-24 flex items-center justify-center">
        {/* Particle dots representing other members */}
        {particles.map((p, i) => (
          <motion.span
            key={i}
            className="absolute rounded-full bg-emerald-400/50"
            style={{ width: p.size, height: p.size }}
            initial={{ opacity: 0, x: 0, y: 0, scale: 0 }}
            animate={{ opacity: [0, 0.7, 0.45], x: p.x, y: p.y, scale: 1 }}
            transition={{
              delay: p.delay,
              duration: 0.35,
              ease: "easeOut",
            }}
          />
        ))}
        {/* Label appearing letter-by-letter */}
        <span className="relative z-10 text-xl font-semibold tracking-wide">
          {label.split("").map((ch, i) => (
            <motion.span
              key={i}
              className="inline-block"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                delay: 0.04 + i * 0.035,
                duration: 0.12,
                ease: "easeOut",
              }}
            >
              {ch === " " ? "\u00A0" : ch}
            </motion.span>
          ))}
        </span>
      </div>
    </div>
  );
}

// ── Emotion: full-screen colour wash ─────────────────────────────────────────

function EmotionWash({ payload }: { payload: Record<string, unknown> }) {
  const aligned = (payload.aligned as boolean) ?? false;
  const bg = aligned
    ? "radial-gradient(ellipse at 50% 50%, rgba(251,146,60,0.18) 0%, transparent 72%)"
    : "radial-gradient(ellipse at 50% 50%, rgba(99,102,241,0.18) 0%, transparent 72%)";

  return (
    <motion.div
      className="fixed inset-0 pointer-events-none z-0"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
      style={{ background: bg }}
    />
  );
}

// ── Emoji pill bar ────────────────────────────────────────────────────────────

function EmojiBar({
  reacted,
  onReact,
  dark = false,
  center = false,
}: {
  reacted: string | null;
  onReact: (key: string) => void;
  dark?: boolean;
  center?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: 0.5, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className={`w-fit ${center ? "self-center" : "self-start"}`}
    >
      <div
        className="flex items-center gap-0.5 rounded-full p-1"
        style={
          dark
            ? {
                background: "rgba(255,255,255,0.10)",
                backdropFilter: "blur(24px) saturate(1.6)",
                WebkitBackdropFilter: "blur(24px) saturate(1.6)",
                border: "1px solid rgba(255,255,255,0.20)",
                boxShadow:
                  "0 4px 24px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.22), inset 0 -1px 0 rgba(0,0,0,0.08)",
              }
            : {
                background: "rgba(255,255,255,0.72)",
                backdropFilter: "blur(20px) saturate(1.8)",
                WebkitBackdropFilter: "blur(20px) saturate(1.8)",
                border: "1px solid rgba(0,0,0,0.08)",
                boxShadow:
                  "0 2px 20px rgba(0,0,0,0.09), inset 0 1px 0 rgba(255,255,255,0.9), inset 0 -1px 0 rgba(0,0,0,0.04)",
              }
        }
      >
        {REACTIONS.map(({ key, emoji, hex }) => {
          const isMe = reacted === key;
          const isDimmed = reacted !== null && !isMe;

          return (
            <motion.button
              key={key}
              onClick={(e) => { e.stopPropagation(); if (!reacted) onReact(key); }}
              disabled={reacted !== null}
              animate={{
                scale: isDimmed ? 0.72 : 1,
                opacity: isDimmed ? 0.22 : 1,
              }}
              whileHover={!reacted ? { scale: 1.28, y: -5 } : {}}
              whileTap={!reacted ? { scale: 0.88 } : {}}
              transition={{ type: "spring", stiffness: 420, damping: 22 }}
              className="relative flex h-9 w-9 cursor-pointer items-center justify-center rounded-full disabled:cursor-default"
              style={{
                background: isMe
                  ? dark ? "rgba(255,255,255,0.22)" : "rgba(0,0,0,0.08)"
                  : "transparent",
              }}
              title={emoji}
            >
              <Lottie
                // @ts-expect-error — path prop works at runtime; not in older type defs
                path={notoUrl(hex)}
                loop
                autoplay
                style={{ width: 28, height: 28, pointerEvents: "none" }}
              />
            </motion.button>
          );
        })}
      </div>
    </motion.div>
  );
}

// ── Main Reflection component ────────────────────────────────────────────────

export function Reflection({
  reflection,
  sessionId,
  questionId,
  questionInputType,
  splitLayout = false,
  displayText,
  ttsDone,
  showFallbackCopy,
  onDone,
}: ReflectionProps) {
  const [reacted, setReacted] = useState<string | null>(null);
  const [showContinue, setShowContinue] = useState(false);
  const continueTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const doneRef = useRef(false);

  // Reveal the Continue button 1 s after TTS playback finishes. No silent
  // auto-advance — the user must press Continue. Reactions are visual only.
  useEffect(() => {
    if (!ttsDone) {
      setShowContinue(false);
      return;
    }
    if (continueTimerRef.current) clearTimeout(continueTimerRef.current);
    continueTimerRef.current = setTimeout(
      () => setShowContinue(true),
      CONTINUE_AFTER_TTS_MS
    );
    return () => {
      if (continueTimerRef.current) clearTimeout(continueTimerRef.current);
    };
  }, [ttsDone]);

  const advance = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (continueTimerRef.current) clearTimeout(continueTimerRef.current);
    onDone();
  }, [onDone]);

  function handleContinue() {
    if (!showContinue) return;
    advance();
  }

  function handleCardClick() {
    if (showContinue) advance();
  }

  function handleCardKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!showContinue) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      advance();
    }
  }

  useEffect(() => {
    return () => {
      if (continueTimerRef.current) clearTimeout(continueTimerRef.current);
    };
  }, []);

  // Reacting registers the emoji visually + in DB, then advances after a
  // short pause so the animation is visible before moving on.
  function handleReaction(key: string) {
    if (reacted) return;
    setReacted(key);

    if (sessionId) {
      fetch("/api/reactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          question_id: questionId,
          reaction: key,
        }),
      }).catch(() => {});
    }

    // Advance after the emoji pop animation settles
    setTimeout(() => advance(), 900);
  }

  const { type, copy, payload } = reflection;
  // Three-state render driven entirely by parent narration props (Phase 6.5e):
  // 1. typewriter ticking (`displayText` non-empty) → show what's revealed
  // 2. fallback fired (`showFallbackCopy=true`) → show full `copy`
  // 3. otherwise → render <HeadlineLoader />
  const isLoading = !displayText && !showFallbackCopy;
  const headlineText = displayText
    ? displayText
    : showFallbackCopy
      ? copy
      : "";
  const quotes = Array.isArray(payload.quotes)
    ? payload.quotes.filter((q): q is string => typeof q === "string")
    : [];

  // True if a distribution payload contains at least one positive count
  function hasNonZeroDistribution(value: unknown): boolean {
    if (!value || typeof value !== "object") return false;
    return Object.values(value as Record<string, unknown>).some(
      (v) => typeof v === "number" && v > 0
    );
  }

  const useTribeLayout = type === "tribe" && quotes.length > 0;
  const useSliderLayout =
    type === "comparison" &&
    questionInputType === "emoji_slider" &&
    hasNonZeroDistribution(payload.distribution);
  const useDistributionLayout =
    (type === "majority" || type === "minority") &&
    (questionInputType === "cards" || questionInputType === "this_or_that") &&
    hasNonZeroDistribution(payload.distribution);

  // No special visual to fill the right-side card — render copy alone
  const noRightVisual = !useTribeLayout && !useSliderLayout && !useDistributionLayout;

  const splitVisual = useTribeLayout ? (
    <ReflectionTribe copy={copy} quotes={quotes} hideHeadline displayText={headlineText} />
  ) : useSliderLayout ? (
    <ReflectionSlider copy={copy} payload={payload} hideHeadline displayText={headlineText} />
  ) : useDistributionLayout ? (
    <ReflectionDistribution copy={copy} payload={payload} hideHeadline displayText={headlineText} />
  ) : (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="w-full flex justify-center"
    >
      {type === "comparison" && <ComparisonVisual payload={payload} />}
      {type === "majority" && <MajorityVisual payload={payload} />}
      {type === "minority" && <MinorityVisual payload={payload} />}
      {type === "tribe" && <TribeVisual payload={payload} />}
    </motion.div>
  );

  if (splitLayout) {
    // No meaningful visual → render copy alone, full-width, centered. Drop the white card.
    if (noRightVisual) {
      return (
        <div
          className="flex min-h-screen w-full items-center justify-center p-5 md:p-8"
          role={showContinue ? "button" : undefined}
          tabIndex={showContinue ? 0 : undefined}
          onClick={handleCardClick}
          onKeyDown={handleCardKeyDown}
        >
          <div className="flex w-full max-w-3xl flex-col items-center gap-7 px-6 text-center md:px-12">
            <motion.h1
              className="font-display text-[2.625rem] leading-tight tracking-tight text-white md:text-[3.375rem]"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, ease: "easeOut" }}
            >
              {isLoading ? <HeadlineLoader /> : headlineText}
            </motion.h1>
            {showContinue && (
              <EmojiBar reacted={reacted} onReact={handleReaction} dark center />
            )}

            {showContinue && (
              <motion.button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleContinue();
                }}
                className="text-sm text-white/60 transition-colors hover:text-white"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: [0.6, 1, 0.6], y: 0 }}
                transition={{ opacity: { duration: 2, repeat: Infinity }, y: { duration: 0.2 } }}
              >
                Continue →
              </motion.button>
            )}

            {reflection.source && (
              <p className="fixed bottom-3 right-4 text-xs uppercase text-white/40">
                {reflection.source === "llm" ? "{llm}" : "{fallback}"}
              </p>
            )}
          </div>
        </div>
      );
    }

    return (
      <div
        className="flex min-h-screen w-full -translate-y-6 flex-col gap-6 p-5 md:-translate-y-8 md:flex-row md:p-8"
        role={showContinue ? "button" : undefined}
        tabIndex={showContinue ? 0 : undefined}
        onClick={handleCardClick}
        onKeyDown={handleCardKeyDown}
      >
        <div className="flex w-full flex-col justify-center gap-7 px-8 pt-16 md:w-[55%] md:px-14 md:pt-0">
          <motion.h1
            className="font-display max-w-2xl text-left text-[2.625rem] leading-tight tracking-tight text-white md:text-[3.375rem]"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: "easeOut" }}
          >
            {isLoading ? <HeadlineLoader /> : headlineText}
          </motion.h1>
          {showContinue && !useSliderLayout && (
            <EmojiBar reacted={reacted} onReact={handleReaction} dark />
          )}
        </div>
        <div className="flex w-full items-center justify-center md:w-[45%]">
          <div className="relative flex w-full max-w-2xl flex-col items-center justify-center gap-8 rounded-3xl bg-white p-9 text-black shadow-2xl md:p-14">
            {splitVisual}

            {showContinue && (
              <motion.button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleContinue();
                }}
                className="text-sm text-muted-foreground/60 transition-colors hover:text-muted-foreground"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: [0.6, 1, 0.6], y: 0 }}
                transition={{ opacity: { duration: 2, repeat: Infinity }, y: { duration: 0.2 } }}
              >
                Continue →
              </motion.button>
            )}

            {reflection.source && (
              <p className="absolute bottom-3 right-4 text-xs uppercase text-muted-foreground/40">
                {reflection.source === "llm" ? "{llm}" : "{fallback}"}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Emotion wash — behind everything, full-screen */}
      {type === "emotion" &&
        !useTribeLayout &&
        !useSliderLayout &&
        !useDistributionLayout && <EmotionWash payload={payload} />}

      <div
        className={`relative z-10 flex w-full flex-col items-center justify-center gap-8 px-8 py-10 mx-auto ${
          useSliderLayout || useDistributionLayout ? "max-w-4xl" : "max-w-lg"
        }`}
        role={showContinue ? "button" : undefined}
        tabIndex={showContinue ? 0 : undefined}
        onClick={handleCardClick}
        onKeyDown={handleCardKeyDown}
      >
        {useTribeLayout ? (
          <ReflectionTribe copy={copy} quotes={quotes} displayText={headlineText} />
        ) : useSliderLayout ? (
          <ReflectionSlider copy={copy} payload={payload} displayText={headlineText} />
        ) : useDistributionLayout ? (
          <ReflectionDistribution copy={copy} payload={payload} displayText={headlineText} />
        ) : (
          <>
            {/* Type-specific visual */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className="w-full flex justify-center"
            >
              {type === "comparison" && <ComparisonVisual payload={payload} />}
              {type === "majority" && <MajorityVisual payload={payload} />}
              {type === "minority" && <MinorityVisual payload={payload} />}
              {type === "tribe" && <TribeVisual payload={payload} />}
              {/* emotion has no inline visual — it's the full-screen wash */}
            </motion.div>

            {/* Copy headline */}
            <motion.p
              className="text-center text-lg font-medium leading-snug"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.25 }}
            >
              {isLoading ? <HeadlineLoader /> : headlineText}
            </motion.p>
          </>
        )}

        {showContinue && !useSliderLayout && (
          <EmojiBar reacted={reacted} onReact={handleReaction} />
        )}

        {reflection.source && (
          <p className="absolute bottom-3 right-4 text-xs uppercase text-muted-foreground/40">
            {reflection.source === "llm" ? "{llm}" : "{fallback}"}
          </p>
        )}

        {showContinue && (
          <motion.button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleContinue();
            }}
            className="text-sm text-muted-foreground/60 hover:text-muted-foreground transition-colors"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: [0.6, 1, 0.6], y: 0 }}
            transition={{ opacity: { duration: 2, repeat: Infinity }, y: { duration: 0.2 } }}
          >
            Continue →
          </motion.button>
        )}
      </div>
    </>
  );
}
