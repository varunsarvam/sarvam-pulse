"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { Question } from "@/lib/types";

interface ThisOrThatProps {
  question: Question;
  options: string[];
  onSubmit: (value: { type: "this_or_that"; value: string }) => void;
  disabled?: boolean;
}

// Per-side accent palette
const ACCENT = {
  left:  { light: "rgba(255,107,53,0.08)",  mid: "rgba(255,107,53,0.18)",  strong: "rgba(255,107,53,0.28)",  ring: "#ff6b35" },
  right: { light: "rgba(59,127,212,0.08)",  mid: "rgba(59,127,212,0.18)",  strong: "rgba(59,127,212,0.28)",  ring: "#3b7fd4" },
} as const;

export function ThisOrThat({ question, options, onSubmit, disabled = false }: ThisOrThatProps) {
  const [hovered, setHovered] = useState<0 | 1 | null>(null);
  const [selected, setSelected] = useState<0 | 1 | null>(null);
  const [a, b] = options;

  void question;

  function pick(index: 0 | 1) {
    if (disabled || selected !== null) return;
    setSelected(index);
    setTimeout(() => onSubmit({ type: "this_or_that", value: options[index] }), 380);
  }

  function cardState(index: 0 | 1): "selected" | "dismissed" | "hovered" | "idle" {
    if (selected === index) return "selected";
    if (selected !== null) return "dismissed";
    if (hovered === index) return "hovered";
    return "idle";
  }

  return (
    <div className="relative flex w-full items-stretch gap-0" style={{ height: 220 }}>
      <Card
        label={a}
        badge="A"
        side="left"
        state={cardState(0)}
        onHover={() => setHovered(0)}
        onLeave={() => setHovered(null)}
        onPick={() => pick(0)}
        disabled={disabled || selected !== null}
      />

      {/* Divider with "or" pill */}
      <div className="relative z-10 flex w-0 items-center justify-center">
        <motion.div
          animate={{ opacity: selected !== null ? 0 : 1, scale: selected !== null ? 0.7 : 1 }}
          transition={{ duration: 0.22 }}
          className="absolute flex flex-col items-center gap-1 select-none"
        >
          <div className="h-16 w-px bg-zinc-200" />
          <span className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-widest text-zinc-400">
            or
          </span>
          <div className="h-16 w-px bg-zinc-200" />
        </motion.div>
      </div>

      <Card
        label={b}
        badge="B"
        side="right"
        state={cardState(1)}
        onHover={() => setHovered(1)}
        onLeave={() => setHovered(null)}
        onPick={() => pick(1)}
        disabled={disabled || selected !== null}
      />
    </div>
  );
}

// ─── Card ─────────────────────────────────────────────────────────────────────

type CardState = "selected" | "dismissed" | "hovered" | "idle";

function Card({
  label,
  badge,
  state,
  side,
  onHover,
  onLeave,
  onPick,
  disabled,
}: {
  label: string;
  badge: string;
  state: CardState;
  side: "left" | "right";
  onHover: () => void;
  onLeave: () => void;
  onPick: () => void;
  disabled: boolean;
}) {
  const acc = ACCENT[side];
  const radius = side === "left" ? "rounded-l-2xl rounded-r-lg" : "rounded-r-2xl rounded-l-lg";

  const bgColor =
    state === "selected"  ? acc.strong :
    state === "hovered"   ? acc.mid    :
    acc.light;

  const scale =
    state === "selected"  ? 1.03 :
    state === "dismissed" ? 0.93 :
    state === "hovered"   ? 1.02 : 1;

  const opacity = state === "dismissed" ? 0.35 : 1;

  // Radial gradient bloom — origin from outer corner
  const bloomOrigin = side === "left" ? "circle at 100% 50%" : "circle at 0% 50%";

  return (
    <motion.button
      animate={{ scale, opacity }}
      transition={{ type: "spring", stiffness: 340, damping: 26 }}
      onHoverStart={onHover}
      onHoverEnd={onLeave}
      onClick={onPick}
      disabled={disabled}
      className={`relative flex flex-1 flex-col items-center justify-center overflow-hidden border border-zinc-200 bg-white ${radius} cursor-pointer disabled:cursor-default focus-visible:outline-none focus-visible:ring-2`}
      style={{ focusRingColor: acc.ring } as React.CSSProperties}
    >
      {/* Gradient bloom */}
      <motion.span
        className="pointer-events-none absolute inset-0"
        animate={{ opacity: state === "idle" ? 0 : 1 }}
        transition={{ duration: 0.3 }}
        style={{ background: `radial-gradient(${bloomOrigin}, ${bgColor} 0%, transparent 80%)` }}
      />

      {/* Badge */}
      <motion.span
        className="absolute top-4 text-[10px] font-bold uppercase tracking-widest"
        style={{ [side === "left" ? "left" : "right"]: 16, color: acc.ring, opacity: state === "idle" ? 0.35 : 0.8 }}
        animate={{ opacity: state === "idle" ? 0.35 : 0.8 }}
        transition={{ duration: 0.2 }}
      >
        {badge}
      </motion.span>

      {/* Label */}
      <motion.span
        className="relative z-10 px-6 text-center text-xl font-semibold leading-snug text-zinc-800"
        animate={{ y: state === "hovered" || state === "selected" ? -2 : 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 30 }}
      >
        {label}
      </motion.span>

      {/* Selected checkmark */}
      <AnimatePresence>
        {state === "selected" && (
          <motion.span
            className="absolute bottom-4 text-base"
            initial={{ opacity: 0, scale: 0.5, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 22 }}
            style={{ color: acc.ring }}
          >
            ✓
          </motion.span>
        )}
      </AnimatePresence>

      {/* Shimmer on hover */}
      {state === "hovered" && (
        <motion.span
          className="pointer-events-none absolute inset-0"
          initial={{ x: "-100%" }}
          animate={{ x: "200%" }}
          transition={{ duration: 0.55, ease: "easeInOut" }}
          style={{
            background: "linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.45) 50%, transparent 60%)",
          }}
        />
      )}
    </motion.button>
  );
}
