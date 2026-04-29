"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import type { Question } from "@/lib/types";

interface VisualOption {
  label: string;
  image_url: string;
}

interface VisualSelectProps {
  question: Question;
  options: VisualOption[];
  onSubmit: (value: { type: "visual_select"; value: string }) => void;
  disabled?: boolean;
}

export function VisualSelect({ question, options, onSubmit, disabled = false }: VisualSelectProps) {
  const [selected, setSelected] = useState<string | null>(null);

  void question;

  // 3 or more options → 3-col grid; 1–2 → side by side
  const cols = options.length >= 3 ? "grid-cols-3" : "grid-cols-2";

  function pick(label: string) {
    if (disabled || selected !== null) return;
    setSelected(label);
    setTimeout(() => onSubmit({ type: "visual_select", value: label }), 400);
  }

  return (
    <div className={`grid ${cols} gap-3 w-full`}>
      {options.map((opt) => {
        const isSelected = selected === opt.label;
        const isDimmed = selected !== null && !isSelected;

        return (
          <motion.button
            key={opt.label}
            onClick={() => pick(opt.label)}
            disabled={disabled || selected !== null}
            animate={
              isSelected
                ? { scale: 1.04, opacity: 1 }
                : isDimmed
                ? { scale: 0.96, opacity: 0.35 }
                : { scale: 1, opacity: 1 }
            }
            whileHover={!disabled && selected === null ? { scale: 1.02 } : {}}
            whileTap={!disabled && selected === null ? { scale: 0.97 } : {}}
            transition={{ type: "spring", stiffness: 340, damping: 26 }}
            className="group relative flex flex-col overflow-hidden rounded-xl border bg-card text-left shadow-sm disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            style={{
              borderColor: isSelected
                ? "hsl(var(--foreground) / 0.8)"
                : "hsl(var(--border))",
              borderWidth: isSelected ? 2 : 1,
            }}
          >
            {/* Image */}
            <div className="relative aspect-square w-full overflow-hidden bg-muted">
              {opt.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={opt.image_url}
                  alt={opt.label}
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-2xl text-muted-foreground/30">
                  ?
                </div>
              )}

              {/* Selection checkmark overlay */}
              {isSelected && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.7 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ type: "spring", stiffness: 400, damping: 22 }}
                  className="absolute inset-0 flex items-center justify-center bg-foreground/10"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-foreground text-background text-sm font-bold shadow">
                    ✓
                  </span>
                </motion.div>
              )}
            </div>

            {/* Label */}
            <div className="px-2.5 py-2">
              <p className="truncate text-xs font-medium text-card-foreground">
                {opt.label}
              </p>
            </div>
          </motion.button>
        );
      })}
    </div>
  );
}
