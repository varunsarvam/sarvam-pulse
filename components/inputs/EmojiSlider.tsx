"use client";

import { useRef, useState, useCallback } from "react";
import { motion, useMotionValue, useTransform, animate } from "framer-motion";
import type { Question } from "@/lib/types";

interface EmojiSliderProps {
  question: Question;
  onSubmit: (value: { type: "emoji_slider"; value: number }) => void;
  disabled?: boolean;
}

// ─── Breakpoints ──────────────────────────────────────────────────────────────

const STEPS: { at: number; emoji: string; label: string }[] = [
  { at: 0,   emoji: "😞", label: "Strongly disagree" },
  { at: 17,  emoji: "😕", label: "Disagree"          },
  { at: 33,  emoji: "😶", label: "Not sure"          },
  { at: 50,  emoji: "😐", label: "Neutral"           },
  { at: 67,  emoji: "🙂", label: "Agree"             },
  { at: 83,  emoji: "😊", label: "Strongly agree"    },
  { at: 100, emoji: "😄", label: "Absolutely!"       },
];

function getStep(value: number) {
  let closest = STEPS[0];
  let minDist = Infinity;
  for (const s of STEPS) {
    const d = Math.abs(s.at - value);
    if (d < minDist) { minDist = d; closest = s; }
  }
  return closest;
}

// Interpolate r,g,b between gradient stops: red → yellow → green
function gradientColor(pct: number): string {
  const stops = [
    { p: 0,   r: 239, g:  68, b:  68 },
    { p: 50,  r: 234, g: 179, b:   8 },
    { p: 100, r:  34, g: 197, b:  94 },
  ];
  let lo = stops[0], hi = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (pct >= stops[i].p && pct <= stops[i + 1].p) {
      lo = stops[i]; hi = stops[i + 1]; break;
    }
  }
  const t = lo.p === hi.p ? 0 : (pct - lo.p) / (hi.p - lo.p);
  const r = Math.round(lo.r + (hi.r - lo.r) * t);
  const g = Math.round(lo.g + (hi.g - lo.g) * t);
  const b = Math.round(lo.b + (hi.b - lo.b) * t);
  return `rgb(${r},${g},${b})`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function EmojiSlider({ question, onSubmit, disabled = false }: EmojiSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState(50);
  const [dragging, setDragging] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const x = useMotionValue(0); // initialized after layout via useCallback

  void question;

  const step = getStep(value);
  const thumbColor = gradientColor(value);

  // Convert track x position → 0–100 value
  const xToValue = useCallback((px: number): number => {
    const track = trackRef.current;
    if (!track) return 50;
    const w = track.getBoundingClientRect().width;
    return Math.round(Math.max(0, Math.min(100, (px / w) * 100)));
  }, []);

  // Initialize thumb to center on first render
  const initThumb = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    // Wait one frame for layout
    requestAnimationFrame(() => {
      const track = trackRef.current;
      if (!track) return;
      const w = track.getBoundingClientRect().width;
      x.set(w * 0.5);
    });
  }, [x]);

  // Click anywhere on track → jump thumb
  function handleTrackClick(e: React.MouseEvent<HTMLDivElement>) {
    if (disabled || submitted) return;
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const w = rect.width;
    const clamped = Math.max(0, Math.min(w, px));
    x.set(clamped);
    setValue(xToValue(clamped));
  }

  function handleSubmit() {
    if (disabled || submitted) return;
    setSubmitted(true);
    onSubmit({ type: "emoji_slider", value });
  }

  // Scale emoji: larger at extremes, normal at center
  const emojiScale = 1 + (Math.abs(value - 50) / 50) * 0.3;

  return (
    <div className="flex w-full flex-col items-center gap-6 py-4">

      {/* ── Big animated emoji ── */}
      <motion.div className="relative flex h-24 w-24 items-center justify-center">
        {/* Glow ring behind emoji */}
        <motion.span
          className="absolute inset-0 rounded-full"
          animate={{
            boxShadow: dragging
              ? `0 0 0 10px ${thumbColor}22, 0 0 0 20px ${thumbColor}0a`
              : `0 0 0 0px ${thumbColor}00`,
          }}
          transition={{ duration: 0.25 }}
        />
        <motion.span
          key={step.emoji}
          initial={{ scale: 0.5, rotate: -12, opacity: 0 }}
          animate={{ scale: emojiScale, rotate: 0, opacity: 1 }}
          transition={{ type: "spring", stiffness: 380, damping: 18 }}
          className="select-none text-7xl leading-none"
          style={{ display: "inline-block" }}
        >
          {step.emoji}
        </motion.span>
      </motion.div>

      {/* ── Label ── */}
      <motion.p
        key={step.label}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="text-base font-semibold tracking-wide text-zinc-700"
      >
        {step.label}
      </motion.p>

      {/* ── Track + thumb ── */}
      <div className="w-full px-2">
        {/* Clickable track area */}
        <div
          ref={trackRef}
          className="relative flex cursor-pointer items-center py-4"
          onClick={handleTrackClick}
        >
          {/* Track bar */}
          <div
            className="h-3 w-full overflow-hidden rounded-full"
            style={{ background: "linear-gradient(to right, #ef4444, #eab308, #22c55e)" }}
          />

          {/* Thumb */}
          <motion.div
            ref={initThumb}
            drag={disabled || submitted ? false : "x"}
            dragConstraints={trackRef}
            dragElastic={0}
            dragMomentum={false}
            style={{ x, position: "absolute", top: "50%", y: "-50%" }}
            onDragStart={() => setDragging(true)}
            onDrag={() => {
              const track = trackRef.current;
              if (!track) return;
              const w = track.getBoundingClientRect().width;
              const raw = x.get();
              const clamped = Math.max(0, Math.min(w, raw));
              if (raw !== clamped) x.set(clamped);
              setValue(xToValue(clamped));
            }}
            onDragEnd={() => setDragging(false)}
            onClick={(e) => e.stopPropagation()}
            className="flex h-10 w-10 -translate-x-1/2 cursor-grab items-center justify-center rounded-full bg-white active:cursor-grabbing"
            style={{
              boxShadow: "0 2px 12px rgba(0,0,0,0.18), 0 0 0 3px " + thumbColor,
            }}
            whileTap={{ scale: 1.2 }}
            animate={{ scale: dragging ? 1.18 : 1 }}
            transition={{ type: "spring", stiffness: 400, damping: 24 }}
          >
            {/* Inner colored dot */}
            <motion.span
              className="h-3 w-3 rounded-full"
              animate={{ backgroundColor: thumbColor }}
              transition={{ duration: 0.15 }}
            />
          </motion.div>
        </div>

        {/* Emoji step markers */}
        <div className="flex justify-between px-1 pt-1">
          {STEPS.map((s) => (
            <button
              key={s.at}
              type="button"
              disabled={disabled || submitted}
              onClick={(e) => {
                e.stopPropagation();
                const track = trackRef.current;
                if (!track) return;
                const w = track.getBoundingClientRect().width;
                const px = (s.at / 100) * w;
                animate(x, px, { type: "spring", stiffness: 320, damping: 24 });
                setValue(s.at);
              }}
              className="text-lg leading-none transition-transform hover:scale-125 disabled:pointer-events-none"
              style={{ opacity: step.at === s.at ? 1 : 0.35 }}
              title={s.label}
            >
              {s.emoji}
            </button>
          ))}
        </div>
      </div>

      {/* ── Confirm ── */}
      <motion.button
        onClick={handleSubmit}
        disabled={disabled || submitted}
        whileHover={!disabled && !submitted ? { scale: 1.03 } : {}}
        whileTap={!disabled && !submitted ? { scale: 0.97 } : {}}
        className="group relative isolate mt-2 h-12 overflow-hidden rounded-full bg-[#111820] px-10 text-sm font-medium text-white shadow-none transition-transform hover:bg-[#0b1118] disabled:opacity-45"
      >
        <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_24%_12%,rgba(255,255,255,0.16),transparent_30%),linear-gradient(135deg,rgba(255,255,255,0.08),transparent_45%)]" />
        <span className="pointer-events-none absolute -left-12 top-0 h-full w-12 -skew-x-12 bg-white/30 blur-lg transition-transform duration-700 group-hover:translate-x-48" />
        <span className="relative z-10">{submitted ? "✓" : "Confirm"}</span>
      </motion.button>
    </div>
  );
}
