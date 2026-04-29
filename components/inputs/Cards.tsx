"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import type { Question } from "@/lib/types";

interface CardsProps {
  question: Question;
  options: string[];
  onSubmit: (value: { type: "cards"; value: string }) => void;
  disabled?: boolean;
}

export function Cards({ question, options, onSubmit, disabled = false }: CardsProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const visible = options.slice(0, 4);

  void question;

  function pick(opt: string) {
    if (disabled || selected !== null) return;
    setSelected(opt);
    setTimeout(() => onSubmit({ type: "cards", value: opt }), 400);
  }

  return (
    <div className="flex flex-col gap-3 w-full">
      {visible.map((opt) => {
        const isSelected = selected === opt;
        const isDimmed = selected !== null && !isSelected;

        return (
          <motion.button
            key={opt}
            layoutId={`card-${opt}`}
            onClick={() => pick(opt)}
            disabled={disabled || selected !== null}
            animate={
              isSelected
                ? { scale: 1.03, opacity: 1 }
                : isDimmed
                ? { scale: 0.97, opacity: 0.35 }
                : { scale: 1, opacity: 1 }
            }
            whileHover={!disabled && selected === null ? { scale: 1.015 } : {}}
            whileTap={!disabled && selected === null ? { scale: 0.98 } : {}}
            transition={{ type: "spring", stiffness: 340, damping: 26 }}
            className="relative w-full rounded-xl border border-border bg-card px-5 py-4 text-left text-base font-medium text-card-foreground shadow-sm cursor-pointer disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {/* Glow ring on selected */}
            {isSelected && (
              <motion.span
                layoutId="card-glow"
                className="pointer-events-none absolute inset-0 rounded-xl"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                style={{
                  boxShadow: "0 0 0 2px hsl(var(--foreground) / 0.7), 0 4px 24px hsl(var(--foreground) / 0.12)",
                }}
              />
            )}
            {opt}
          </motion.button>
        );
      })}
    </div>
  );
}
