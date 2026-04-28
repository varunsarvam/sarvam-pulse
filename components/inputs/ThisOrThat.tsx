"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import type { Question } from "@/lib/types";

interface ThisOrThatProps {
  question: Question;
  options: string[];
  onSubmit: (value: { type: "this_or_that"; value: string }) => void;
}

export function ThisOrThat({ question, options, onSubmit }: ThisOrThatProps) {
  const [hovered, setHovered] = useState<0 | 1 | null>(null);
  const [selected, setSelected] = useState<0 | 1 | null>(null);
  const [a, b] = options;

  void question;

  function pick(index: 0 | 1) {
    if (selected !== null) return;
    setSelected(index);
    setTimeout(() => onSubmit({ type: "this_or_that", value: options[index] }), 300);
  }

  function cardState(index: 0 | 1): "selected" | "dismissed" | "hovered" | "idle" {
    if (selected === index) return "selected";
    if (selected !== null) return "dismissed";
    if (hovered === index) return "hovered";
    return "idle";
  }

  return (
    <div className="flex items-stretch gap-0 w-full h-52 relative">
      {/* Card A */}
      <Card
        label={a}
        state={cardState(0)}
        side="left"
        onHover={() => setHovered(0)}
        onLeave={() => setHovered(null)}
        onPick={() => pick(0)}
        disabled={selected !== null}
      />

      {/* "or" divider */}
      <div className="relative z-10 flex items-center justify-center w-0">
        <motion.span
          animate={{ opacity: selected !== null ? 0 : 1 }}
          transition={{ duration: 0.2 }}
          className="absolute text-xs font-semibold text-muted-foreground bg-background rounded-full border border-border px-2 py-1 select-none"
        >
          or
        </motion.span>
      </div>

      {/* Card B */}
      <Card
        label={b}
        state={cardState(1)}
        side="right"
        onHover={() => setHovered(1)}
        onLeave={() => setHovered(null)}
        onPick={() => pick(1)}
        disabled={selected !== null}
      />
    </div>
  );
}

// ─── Individual card ──────────────────────────────────────────────────────────

type CardState = "selected" | "dismissed" | "hovered" | "idle";

function Card({
  label,
  state,
  side,
  onHover,
  onLeave,
  onPick,
  disabled,
}: {
  label: string;
  state: CardState;
  side: "left" | "right";
  onHover: () => void;
  onLeave: () => void;
  onPick: () => void;
  disabled: boolean;
}) {
  const animate = {
    scale: state === "selected" ? 1.04 : state === "dismissed" ? 0.94 : state === "hovered" ? 1.025 : 1,
    opacity: state === "dismissed" ? 0.3 : 1,
    transition: { type: "spring", stiffness: 360, damping: 28 } as const,
  };

  const radius = side === "left" ? "rounded-l-2xl rounded-r-md" : "rounded-r-2xl rounded-l-md";

  return (
    <motion.button
      animate={animate}
      onHoverStart={onHover}
      onHoverEnd={onLeave}
      onTapStart={onHover}
      onClick={onPick}
      disabled={disabled}
      className={`relative flex flex-1 items-center justify-center ${radius} border border-border bg-card text-card-foreground font-semibold text-lg shadow-sm cursor-pointer disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring overflow-hidden`}
    >
      {/* Flash highlight on select */}
      {state === "selected" && (
        <motion.span
          className="pointer-events-none absolute inset-0"
          initial={{ opacity: 0.35 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 0.35 }}
          style={{ background: "hsl(var(--foreground) / 0.08)" }}
        />
      )}
      {label}
    </motion.button>
  );
}
