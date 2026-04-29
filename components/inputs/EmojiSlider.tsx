"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import type { Question } from "@/lib/types";

interface EmojiSliderProps {
  question: Question;
  onSubmit: (value: { type: "emoji_slider"; value: number }) => void;
  disabled?: boolean;
}

// ─── Breakpoints ──────────────────────────────────────────────────────────────

const BREAKPOINTS: { max: number; emoji: string; label: string }[] = [
  { max: 10,  emoji: "😞", label: "Strongly disagree" },
  { max: 28,  emoji: "😕", label: "Disagree"          },
  { max: 42,  emoji: "😶", label: "Not sure"          },
  { max: 58,  emoji: "😐", label: "Neutral"           },
  { max: 72,  emoji: "🙂", label: "Agree"             },
  { max: 90,  emoji: "😊", label: "Strongly agree"    },
  { max: 100, emoji: "😄", label: "Absolutely!"       },
];

function getBreakpoint(value: number) {
  return BREAKPOINTS.find((b) => value <= b.max) ?? BREAKPOINTS[BREAKPOINTS.length - 1];
}

// Scale peaks at 0 and 100, settles at 1.0 around 50
function emojiScale(value: number): number {
  const distance = Math.abs(value - 50) / 50; // 0 at center, 1 at extremes
  return 1 + distance * 0.22;
}

export function EmojiSlider({ question, onSubmit, disabled = false }: EmojiSliderProps) {
  const [value, setValue] = useState(50);
  const bp = getBreakpoint(value);
  const scale = emojiScale(value);

  void question;

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (disabled) return;
    setValue(Number(e.target.value));
  }

  function submit() {
    if (disabled) return;
    onSubmit({ type: "emoji_slider", value });
  }

  return (
    <div className="flex flex-col items-center gap-8 w-full py-4">
      {/* Emoji */}
      <motion.span
        key={bp.emoji}
        initial={{ opacity: 0, scale: 0.7 }}
        animate={{ opacity: 1, scale }}
        transition={{ type: "spring", stiffness: 320, damping: 22 }}
        className="text-6xl leading-none select-none"
        style={{ display: "inline-block" }}
      >
        {bp.emoji}
      </motion.span>

      {/* Slider */}
      <div className={`w-full space-y-3 ${disabled ? "pointer-events-none" : ""}`}>
        <div className="relative h-3 rounded-full overflow-hidden"
          style={{ background: "linear-gradient(to right, #ef4444, #eab308, #22c55e)" }}
        >
          {/* Filled portion overlay — darkens everything to the right of thumb */}
          <div
            className="absolute inset-y-0 right-0 bg-black/25 rounded-r-full transition-none"
            style={{ width: `${100 - value}%` }}
          />
        </div>

        <input
          type="range"
          min={0}
          max={100}
          value={value}
          onChange={handleChange}
          disabled={disabled}
          className="w-full appearance-none bg-transparent cursor-pointer
            [&::-webkit-slider-thumb]:appearance-none
            [&::-webkit-slider-thumb]:h-5
            [&::-webkit-slider-thumb]:w-5
            [&::-webkit-slider-thumb]:rounded-full
            [&::-webkit-slider-thumb]:bg-white
            [&::-webkit-slider-thumb]:shadow-md
            [&::-webkit-slider-thumb]:ring-2
            [&::-webkit-slider-thumb]:ring-border
            [&::-webkit-slider-thumb]:-mt-[22px]
            [&::-webkit-slider-runnable-track]:h-3
            [&::-webkit-slider-runnable-track]:rounded-full
            [&::-webkit-slider-runnable-track]:bg-transparent
            [&::-moz-range-thumb]:h-5
            [&::-moz-range-thumb]:w-5
            [&::-moz-range-thumb]:rounded-full
            [&::-moz-range-thumb]:bg-white
            [&::-moz-range-thumb]:shadow-md
            [&::-moz-range-thumb]:border-2
            [&::-moz-range-thumb]:border-border"
          style={{ marginTop: "-0.875rem", position: "relative" }}
        />
      </div>

      {/* Label */}
      <motion.p
        key={bp.label}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18 }}
        className="text-sm font-medium text-muted-foreground tracking-wide"
      >
        {bp.label}
      </motion.p>

      {/* Confirm */}
      <Button onClick={submit} className="px-8" disabled={disabled}>
        Confirm
      </Button>
    </div>
  );
}
