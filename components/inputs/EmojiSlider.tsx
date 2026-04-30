"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Lottie from "lottie-react";
import type { Question } from "@/lib/types";

interface EmojiSliderProps {
  question: Question;
  onSubmit: (value: { type: "emoji_slider"; value: number }) => void;
  disabled?: boolean;
}

// ─── 6 steps — clean spectrum, 3×2 grid ──────────────────────────────────────

const STEPS = [
  { value: 0,   hex: "1f621", label: "Strongly disagree", bg: "rgba(239,68,68,0.10)",   ring: "#ef4444" },
  { value: 20,  hex: "1f61e", label: "Disagree",          bg: "rgba(249,115,22,0.10)",  ring: "#f97316" },
  { value: 40,  hex: "1f615", label: "Not sure",          bg: "rgba(234,179,8,0.10)",   ring: "#eab308" },
  { value: 60,  hex: "1f642", label: "Agree",             bg: "rgba(132,204,22,0.10)",  ring: "#84cc16" },
  { value: 80,  hex: "1f60a", label: "Strongly agree",    bg: "rgba(34,197,94,0.10)",   ring: "#22c55e" },
  { value: 100, hex: "1f929", label: "Absolutely!",       bg: "rgba(16,185,129,0.14)",  ring: "#10b981" },
] as const;

function notoUrl(hex: string) {
  return `https://fonts.gstatic.com/s/e/notoemoji/latest/${hex}/lottie.json`;
}

// ─── Card ─────────────────────────────────────────────────────────────────────

function EmojiCard({
  step,
  selected,
  disabled,
  onClick,
}: {
  step: typeof STEPS[number];
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div className="relative flex flex-col items-center">
      {/* Tooltip */}
      <AnimatePresence>
        {hovered && !selected && (
          <motion.div
            className="absolute -top-10 z-20 whitespace-nowrap rounded-full bg-zinc-900 px-3 py-1 text-[11px] font-semibold text-white shadow-lg"
            initial={{ opacity: 0, y: 4, scale: 0.88 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.88 }}
            transition={{ duration: 0.14 }}
          >
            {step.label}
            <span className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-zinc-900" />
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        type="button"
        disabled={disabled}
        onClick={onClick}
        onHoverStart={() => setHovered(true)}
        onHoverEnd={() => setHovered(false)}
        animate={{
          scale: selected ? 1.18 : hovered ? 1.1 : 1,
          y: selected ? -6 : hovered ? -4 : 0,
          opacity: 1,
        }}
        whileTap={{ scale: 0.9 }}
        transition={{ type: "spring", stiffness: 380, damping: 22 }}
        className="relative flex flex-col items-center justify-center gap-1.5 disabled:pointer-events-none"
      >
        <Lottie
          path={notoUrl(step.hex)}
          style={{ width: 72, height: 72 }}
          loop
          autoplay
        />
        {/* Label on selected */}
        <AnimatePresence>
          {selected && (
            <motion.span
              className="text-[11px] font-semibold"
              style={{ color: step.ring }}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.18 }}
            >
              {step.label}
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function EmojiSlider({ question, onSubmit, disabled = false }: EmojiSliderProps) {
  const [selected, setSelected] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(false);

  void question;

  function handlePick(value: number) {
    if (disabled || submitted) return;
    setSelected(value);
  }

  function handleSubmit() {
    if (disabled || submitted || selected === null) return;
    setSubmitted(true);
    onSubmit({ type: "emoji_slider", value: selected });
  }

  return (
    <div className="flex w-full flex-col gap-5 py-2">

      {/* ── 3×2 grid ── */}
      <div className="grid grid-cols-3 gap-2">
        {STEPS.map((s) => (
          <EmojiCard
            key={s.value}
            step={s}
            selected={selected === s.value}
            disabled={disabled || submitted}
            onClick={() => handlePick(s.value)}
          />
        ))}
      </div>

      {/* ── Confirm ── */}
      <AnimatePresence>
        {selected !== null && (
          <motion.button
            onClick={handleSubmit}
            disabled={disabled || submitted}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            transition={{ type: "spring", stiffness: 340, damping: 24 }}
            className="group relative isolate mx-auto flex h-11 items-center justify-center overflow-hidden rounded-full bg-[#111820] px-10 text-sm font-medium text-white hover:bg-[#0b1118] disabled:opacity-45"
          >
            <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_24%_12%,rgba(255,255,255,0.16),transparent_30%)]" />
            <span className="pointer-events-none absolute -left-12 top-0 h-full w-12 -skew-x-12 bg-white/30 blur-lg transition-transform duration-700 group-hover:translate-x-48" />
            <span className="relative z-10">{submitted ? "✓" : "Confirm"}</span>
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
