"use client";

import { motion } from "framer-motion";
import type { FormTone } from "@/lib/types";

export type AvatarMode = "idle" | "speaking" | "listening" | "thinking";

const TONE: Record<
  FormTone,
  { core: string; mid: string; outer: string; glow: string }
> = {
  playful: {
    core: "rgba(251,146,60,0.90)",
    mid: "rgba(249,115,22,0.30)",
    outer: "rgba(249,115,22,0.08)",
    glow: "rgba(249,115,22,0.35)",
  },
  calm: {
    core: "rgba(96,165,250,0.90)",
    mid: "rgba(59,130,246,0.30)",
    outer: "rgba(59,130,246,0.08)",
    glow: "rgba(59,130,246,0.35)",
  },
  direct: {
    core: "rgba(209,213,219,0.90)",
    mid: "rgba(156,163,175,0.30)",
    outer: "rgba(156,163,175,0.08)",
    glow: "rgba(156,163,175,0.35)",
  },
  insightful: {
    core: "rgba(167,139,250,0.90)",
    mid: "rgba(139,92,246,0.30)",
    outer: "rgba(139,92,246,0.08)",
    glow: "rgba(139,92,246,0.35)",
  },
};

export function AIPresence({
  tone,
  speaking = false,
  mode = "idle",
}: {
  tone: FormTone;
  speaking?: boolean;
  mode?: AvatarMode;
}) {
  const c = TONE[tone];
  const activeMode = speaking ? "speaking" : mode;

  return (
    <div className="relative flex items-center justify-center w-full h-full select-none">
      {/* Listening: rotating gradient ring */}
      {activeMode === "listening" && (
        <motion.div
          className="absolute rounded-full"
          style={{
            width: 340,
            height: 340,
            background: `conic-gradient(from 0deg, ${c.glow}, transparent 40%, ${c.mid}, transparent 80%, ${c.glow})`,
          }}
          animate={{ rotate: 360 }}
          transition={{ duration: 2.5, repeat: Infinity, ease: "linear" }}
        />
      )}

      {/* Outermost breathing ring */}
      <motion.div
        className="absolute rounded-full"
        style={{ width: 320, height: 320, background: c.outer }}
        animate={
          activeMode === "speaking"
            ? { scale: [1, 1.24, 1], opacity: [0.6, 1, 0.6] }
            : activeMode === "listening"
              ? { scale: [1, 1.1, 1], opacity: [0.7, 1, 0.7] }
              : { scale: [1, 1.14, 1], opacity: [0.5, 0.9, 0.5] }
        }
        transition={{
          duration: activeMode === "speaking" ? 1.1 : activeMode === "listening" ? 1.5 : 6,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />

      {/* Mid ring */}
      <motion.div
        className="absolute rounded-full"
        style={{ width: 210, height: 210, background: c.mid }}
        animate={
          activeMode === "speaking"
            ? { scale: [1, 1.16, 1], opacity: [0.7, 1, 0.7] }
            : activeMode === "listening"
              ? { scale: [1, 1.08, 1], opacity: [0.8, 1, 0.8] }
              : { scale: [1, 1.09, 1], opacity: [0.6, 1, 0.6] }
        }
        transition={{
          duration: activeMode === "speaking" ? 0.9 : activeMode === "listening" ? 1.3 : 4.5,
          repeat: Infinity,
          ease: "easeInOut",
          delay: activeMode === "speaking" ? 0.12 : 0.6,
        }}
      />

      {/* Inner orb */}
      <motion.div
        className="absolute rounded-full"
        style={{
          width: 108,
          height: 108,
          background: `radial-gradient(circle at 38% 32%, white 0%, ${c.core} 55%, transparent 100%)`,
          boxShadow: `0 0 48px ${c.glow}, 0 0 96px ${c.mid}`,
        }}
        animate={
          activeMode === "speaking"
            ? { scale: [1, 1.11, 1] }
            : activeMode === "listening"
              ? { scale: [1, 1.04, 1] }
              : { scale: [1, 1.06, 1] }
        }
        transition={{
          duration: activeMode === "speaking" ? 0.85 : activeMode === "listening" ? 1.2 : 3.5,
          repeat: Infinity,
          ease: "easeInOut",
          delay: activeMode === "speaking" ? 0 : 0.3,
        }}
      />

      {/* Thinking: three dots emerging from center */}
      {activeMode === "thinking" && (
        <div className="absolute flex items-center gap-1.5">
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="h-2.5 w-2.5 rounded-full bg-white/80"
              animate={{
                y: [0, -8, 0],
                opacity: [0.4, 1, 0.4],
                scale: [0.8, 1.1, 0.8],
              }}
              transition={{
                duration: 1,
                repeat: Infinity,
                delay: i * 0.2,
                ease: "easeInOut",
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
