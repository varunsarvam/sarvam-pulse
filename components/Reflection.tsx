"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { motion } from "framer-motion";
import { ReflectionDistribution } from "@/components/reflection/ReflectionDistribution";
import { ReflectionSlider } from "@/components/reflection/ReflectionSlider";
import { ReflectionTribe } from "@/components/reflection/ReflectionTribe";
import type { ReflectionType } from "@/lib/reflection";
import type { InputType } from "@/lib/types";

// ── Props ────────────────────────────────────────────────────────────────────

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
  onDone: () => void;
}

// ── Constants ────────────────────────────────────────────────────────────────

const REACTIONS = [
  { key: "fire", emoji: "🔥" },
  { key: "eyes", emoji: "👀" },
  { key: "hundred", emoji: "💯" },
  { key: "thinking", emoji: "🤔" },
] as const;

const CONTINUE_READY_MS = 5000;
const AUTO_ADVANCE_MS = 9000;
const REACTION_ADVANCE_MS = 1200;

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

  return (
    <div className="w-full max-w-xs mx-auto space-y-2">
      <div className="relative h-2.5 rounded-full bg-muted/30">
        {/* Filled track */}
        <motion.div
          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-blue-500 to-violet-500"
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.45, ease: "easeOut" }}
        />
        {/* Glowing dot */}
        <motion.div
          className="absolute top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-violet-400 border-2 border-background"
          style={{
            left: `${pct}%`,
            marginLeft: -10,
            boxShadow: "0 0 14px 4px rgba(139,92,246,0.55)",
          }}
          initial={{ opacity: 0, scale: 0 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.3, duration: 0.2, type: "spring", bounce: 0.5 }}
        />
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground/40 font-medium">
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

// ── Main Reflection component ────────────────────────────────────────────────

export function Reflection({
  reflection,
  sessionId,
  questionId,
  questionInputType,
  splitLayout = false,
  onDone,
}: ReflectionProps) {
  const [reacted, setReacted] = useState<string | null>(null);
  const [showContinue, setShowContinue] = useState(false);
  const continueTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const doneRef = useRef(false);

  function clearTimers() {
    if (continueTimerRef.current) {
      clearTimeout(continueTimerRef.current);
      continueTimerRef.current = null;
    }
    if (advanceTimerRef.current) {
      clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
    }
  }

  const advance = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    clearTimers();
    onDone();
  }, [onDone]);

  // Let people read first, then invite manual advance before auto-advance.
  useEffect(() => {
    continueTimerRef.current = setTimeout(
      () => setShowContinue(true),
      CONTINUE_READY_MS
    );
    advanceTimerRef.current = setTimeout(advance, AUTO_ADVANCE_MS);
    return clearTimers;
  }, [advance]);

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

  function scheduleReactionAdvance() {
    if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
    advanceTimerRef.current = setTimeout(advance, REACTION_ADVANCE_MS);
  }

  useEffect(() => {
    return () => {
      clearTimers();
    };
  }, []);

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

    scheduleReactionAdvance();
  }

  const { type, copy, payload } = reflection;
  const quotes = Array.isArray(payload.quotes)
    ? payload.quotes.filter((q): q is string => typeof q === "string")
    : [];
  const useTribeLayout = type === "tribe" && quotes.length > 0;
  const useSliderLayout =
    type === "comparison" &&
    questionInputType === "emoji_slider" &&
    typeof payload.distribution === "object" &&
    payload.distribution !== null;
  const useDistributionLayout =
    (type === "majority" || type === "minority") &&
    (questionInputType === "cards" || questionInputType === "this_or_that") &&
    typeof payload.distribution === "object" &&
    payload.distribution !== null;

  const splitVisual = useTribeLayout ? (
    <ReflectionTribe copy={copy} quotes={quotes} hideHeadline />
  ) : useSliderLayout ? (
    <ReflectionSlider copy={copy} payload={payload} hideHeadline />
  ) : useDistributionLayout ? (
    <ReflectionDistribution copy={copy} payload={payload} hideHeadline />
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
    return (
      <div
        className="flex min-h-screen w-full -translate-y-6 flex-col gap-6 p-5 md:-translate-y-8 md:flex-row md:p-8"
        role={showContinue ? "button" : undefined}
        tabIndex={showContinue ? 0 : undefined}
        onClick={handleCardClick}
        onKeyDown={handleCardKeyDown}
      >
        <div className="flex w-full items-center px-8 pt-16 md:w-[55%] md:px-14 md:pt-0">
          <motion.h1
            className="font-display max-w-2xl text-left text-[2.625rem] leading-tight tracking-tight text-white md:text-[3.375rem]"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: "easeOut" }}
          >
            {copy}
          </motion.h1>
        </div>
        <div className="flex w-full items-center justify-center md:w-[45%]">
          <div className="relative flex w-full max-w-2xl flex-col items-center justify-center gap-8 rounded-3xl bg-white p-9 text-black shadow-2xl md:p-14">
            {splitVisual}

            <motion.div
              className="flex items-center gap-4"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.45, duration: 0.2 }}
            >
              {REACTIONS.map(({ key, emoji }) => (
                <motion.button
                  key={key}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleReaction(key);
                  }}
                  disabled={reacted !== null}
                  whileHover={reacted === null ? { scale: 1.18, y: -3 } : {}}
                  whileTap={reacted === null ? { scale: 0.9 } : {}}
                  className={[
                    "relative flex h-16 w-16 items-center justify-center rounded-2xl border border-zinc-200 bg-white text-3xl transition-colors duration-150",
                    reacted === null
                      ? "cursor-pointer hover:border-zinc-300 hover:bg-zinc-50"
                      : "cursor-default",
                    reacted !== null && reacted !== key ? "opacity-30" : "",
                  ].join(" ")}
                >
                  <motion.span
                    animate={
                      reacted === key
                        ? { scale: [1, 1.55, 1.1, 1.25], y: [0, -14, 2, -4] }
                        : {}
                    }
                    transition={
                      reacted === key
                        ? { duration: 0.45, ease: "easeOut" }
                        : undefined
                    }
                  >
                    {emoji}
                  </motion.span>
                </motion.button>
              ))}
            </motion.div>

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
          <ReflectionTribe copy={copy} quotes={quotes} />
        ) : useSliderLayout ? (
          <ReflectionSlider copy={copy} payload={payload} />
        ) : useDistributionLayout ? (
          <ReflectionDistribution copy={copy} payload={payload} />
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
              {copy}
            </motion.p>
          </>
        )}

        {reflection.source && (
          <p className="absolute bottom-3 right-4 text-xs uppercase text-muted-foreground/40">
            {reflection.source === "llm" ? "{llm}" : "{fallback}"}
          </p>
        )}

        {/* Reaction emoji row */}
        <motion.div
          className="flex items-center gap-4"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45, duration: 0.2 }}
        >
          {REACTIONS.map(({ key, emoji }, i) => (
            <motion.button
              key={key}
              onClick={(e) => {
                e.stopPropagation();
                handleReaction(key);
              }}
              disabled={reacted !== null}
              initial={{ opacity: 0, scale: 0.7, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{
                delay: 0.5 + i * 0.07,
                duration: 0.28,
                type: "spring",
                bounce: 0.45,
              }}
              whileHover={reacted === null ? { scale: 1.18, y: -3 } : {}}
              whileTap={reacted === null ? { scale: 0.9 } : {}}
              className={[
                "relative flex items-center justify-center",
                "h-16 w-16 rounded-2xl text-3xl",
                "border border-zinc-200 bg-white",
                "transition-colors duration-150",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                reacted === null
                  ? "hover:border-zinc-300 hover:bg-zinc-50 cursor-pointer"
                  : "cursor-default",
                reacted !== null && reacted !== key ? "opacity-30" : "",
              ].join(" ")}
            >
              {/* Selected glow ring */}
              {reacted === key && (
                <motion.span
                  className="absolute inset-0 rounded-2xl ring-2 ring-foreground/25"
                  initial={{ opacity: 0, scale: 0.85 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.2 }}
                />
              )}

              {/* Bounce + float on selection */}
              <motion.span
                animate={
                  reacted === key
                    ? { scale: [1, 1.55, 1.1, 1.25], y: [0, -14, 2, -4] }
                    : {}
                }
                transition={
                  reacted === key
                    ? { duration: 0.45, ease: "easeOut" }
                    : undefined
                }
                className="select-none"
              >
                {emoji}
              </motion.span>
            </motion.button>
          ))}
        </motion.div>

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
