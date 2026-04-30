"use client";

import { useRef, useState, useCallback } from "react";
import { motion, useMotionValue, animate, AnimatePresence } from "framer-motion";
import Lottie from "lottie-react";
import type { Question } from "@/lib/types";

interface EmojiSliderProps {
  question: Question;
  onSubmit: (value: { type: "emoji_slider"; value: number }) => void;
  disabled?: boolean;
}

// ─── Steps ────────────────────────────────────────────────────────────────────
// Noto Animated Emoji CDN: fonts.gstatic.com/s/e/notoemoji/latest/{hex}/lottie.json

const STEPS: { at: number; hex: string; label: string }[] = [
  { at: 0,   hex: "1f62d", label: "Strongly disagree" },
  { at: 17,  hex: "1f614", label: "Disagree"          },
  { at: 33,  hex: "1fae4", label: "Not sure"          },
  { at: 50,  hex: "1f610", label: "Neutral"           },
  { at: 67,  hex: "1f642", label: "Agree"             },
  { at: 83,  hex: "1f60a", label: "Strongly agree"    },
  { at: 100, hex: "1f604", label: "Absolutely!"       },
];

function notoUrl(hex: string) {
  return `https://fonts.gstatic.com/s/e/notoemoji/latest/${hex}/lottie.json`;
}

function getStep(value: number) {
  return STEPS.reduce((best, s) =>
    Math.abs(s.at - value) < Math.abs(best.at - value) ? s : best
  );
}

function gradientColor(pct: number): string {
  const stops = [
    { p: 0,   r: 239, g: 68,  b: 68  },
    { p: 50,  r: 234, g: 179, b: 8   },
    { p: 100, r: 34,  g: 197, b: 94  },
  ];
  let lo = stops[0], hi = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (pct >= stops[i].p && pct <= stops[i + 1].p) {
      lo = stops[i]; hi = stops[i + 1]; break;
    }
  }
  const t = lo.p === hi.p ? 0 : (pct - lo.p) / (hi.p - lo.p);
  return `rgb(${Math.round(lo.r + (hi.r - lo.r) * t)},${Math.round(lo.g + (hi.g - lo.g) * t)},${Math.round(lo.b + (hi.b - lo.b) * t)})`;
}

// ─── Animated emoji with Lottie ───────────────────────────────────────────────

function AnimatedEmoji({ hex, size = 96 }: { hex: string; size?: number }) {
  const url = notoUrl(hex);
  return (
    <Lottie
      path={url}
      style={{ width: size, height: size }}
      loop
      autoplay
    />
  );
}

// ─── Marker button with hover tooltip ─────────────────────────────────────────

function EmojiMarker({
  step,
  active,
  disabled,
  onClick,
}: {
  step: typeof STEPS[0];
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div className="relative flex flex-col items-center">
      {/* Tooltip */}
      <AnimatePresence>
        {hovered && (
          <motion.div
            className="absolute -top-9 z-20 whitespace-nowrap rounded-full bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-white shadow-lg"
            initial={{ opacity: 0, y: 4, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.9 }}
            transition={{ duration: 0.15 }}
          >
            {step.label}
            <span className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-zinc-900" />
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        type="button"
        disabled={disabled}
        onHoverStart={() => setHovered(true)}
        onHoverEnd={() => setHovered(false)}
        onClick={onClick}
        animate={{ opacity: active ? 1 : 0.3, scale: active ? 1.15 : 1 }}
        whileHover={{ scale: active ? 1.2 : 1.15, opacity: 1 }}
        transition={{ type: "spring", stiffness: 400, damping: 22 }}
        className="disabled:pointer-events-none"
      >
        <AnimatedEmoji hex={step.hex} size={32} />
      </motion.button>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function EmojiSlider({ question, onSubmit, disabled = false }: EmojiSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState(50);
  const [dragging, setDragging] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const x = useMotionValue(0);

  void question;

  const step = getStep(value);
  const thumbColor = gradientColor(value);

  const xToValue = useCallback((px: number): number => {
    const track = trackRef.current;
    if (!track) return 50;
    return Math.round(Math.max(0, Math.min(100, (px / track.getBoundingClientRect().width) * 100)));
  }, []);

  const initThumb = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    requestAnimationFrame(() => {
      const w = trackRef.current?.getBoundingClientRect().width ?? 0;
      x.set(w * 0.5);
    });
  }, [x]);

  function handleTrackClick(e: React.MouseEvent<HTMLDivElement>) {
    if (disabled || submitted) return;
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const px = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    animate(x, px, { type: "spring", stiffness: 320, damping: 24 });
    setValue(xToValue(px));
  }

  function jumpTo(at: number) {
    const track = trackRef.current;
    if (!track) return;
    const w = track.getBoundingClientRect().width;
    animate(x, (at / 100) * w, { type: "spring", stiffness: 320, damping: 24 });
    setValue(at);
  }

  function handleSubmit() {
    if (disabled || submitted) return;
    setSubmitted(true);
    onSubmit({ type: "emoji_slider", value });
  }

  const emojiScale = 1 + (Math.abs(value - 50) / 50) * 0.25;

  return (
    <div className="flex w-full flex-col items-center gap-5 py-4">

      {/* ── Big animated emoji ── */}
      <motion.div
        className="relative flex items-center justify-center"
        animate={{ scale: emojiScale }}
        transition={{ type: "spring", stiffness: 200, damping: 20 }}
      >
        {/* Soft glow */}
        <motion.div
          className="absolute inset-0 rounded-full blur-2xl"
          animate={{
            backgroundColor: thumbColor,
            opacity: dragging ? 0.35 : 0.15,
            scale: dragging ? 1.4 : 1.1,
          }}
          transition={{ duration: 0.3 }}
        />
        <AnimatePresence mode="wait">
          <motion.div
            key={step.hex}
            initial={{ scale: 0.5, rotate: -15, opacity: 0 }}
            animate={{ scale: 1, rotate: 0, opacity: 1 }}
            exit={{ scale: 0.5, rotate: 15, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 18 }}
          >
            <AnimatedEmoji hex={step.hex} size={100} />
          </motion.div>
        </AnimatePresence>
      </motion.div>

      {/* ── Label tooltip ── */}
      <AnimatePresence mode="wait">
        <motion.span
          key={step.label}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.18 }}
          className="rounded-full bg-zinc-900 px-3 py-1 text-xs font-semibold tracking-wide text-white"
        >
          {step.label}
        </motion.span>
      </AnimatePresence>

      {/* ── Track + thumb ── */}
      <div className="w-full px-3">
        <div
          ref={trackRef}
          className="relative flex cursor-pointer items-center py-5"
          onClick={handleTrackClick}
        >
          <div
            className="h-2.5 w-full rounded-full"
            style={{ background: "linear-gradient(to right, #ef4444, #eab308, #22c55e)" }}
          />
          <motion.div
            ref={initThumb}
            drag={disabled || submitted ? false : "x"}
            dragConstraints={trackRef}
            dragElastic={0}
            dragMomentum={false}
            style={{ x, position: "absolute", top: "50%", y: "-50%" }}
            onDragStart={() => setDragging(true)}
            onDrag={() => {
              const w = trackRef.current?.getBoundingClientRect().width ?? 0;
              const clamped = Math.max(0, Math.min(w, x.get()));
              x.set(clamped);
              setValue(xToValue(clamped));
            }}
            onDragEnd={() => setDragging(false)}
            onClick={(e) => e.stopPropagation()}
            whileTap={{ scale: 1.25 }}
            animate={{ scale: dragging ? 1.2 : 1 }}
            transition={{ type: "spring", stiffness: 400, damping: 24 }}
            className="flex h-9 w-9 -translate-x-1/2 cursor-grab items-center justify-center rounded-full bg-white active:cursor-grabbing"
            style={{ boxShadow: `0 2px 14px rgba(0,0,0,0.16), 0 0 0 3px ${thumbColor}` }}
          >
            <motion.span
              className="h-2.5 w-2.5 rounded-full"
              animate={{ backgroundColor: thumbColor }}
              transition={{ duration: 0.15 }}
            />
          </motion.div>
        </div>

        {/* ── Emoji step markers ── */}
        <div className="flex justify-between px-0.5 pt-1">
          {STEPS.map((s) => (
            <EmojiMarker
              key={s.at}
              step={s}
              active={step.at === s.at}
              disabled={disabled || submitted}
              onClick={() => jumpTo(s.at)}
            />
          ))}
        </div>
      </div>

      {/* ── Confirm ── */}
      <motion.button
        onClick={handleSubmit}
        disabled={disabled || submitted}
        whileHover={!submitted ? { scale: 1.03 } : {}}
        whileTap={!submitted ? { scale: 0.97 } : {}}
        className="group relative isolate mt-1 h-12 overflow-hidden rounded-full bg-[#111820] px-10 text-sm font-medium text-white transition-transform hover:bg-[#0b1118] disabled:opacity-45"
      >
        <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_24%_12%,rgba(255,255,255,0.16),transparent_30%)]" />
        <span className="pointer-events-none absolute -left-12 top-0 h-full w-12 -skew-x-12 bg-white/30 blur-lg transition-transform duration-700 group-hover:translate-x-48" />
        <span className="relative z-10">{submitted ? "✓" : "Confirm"}</span>
      </motion.button>
    </div>
  );
}
