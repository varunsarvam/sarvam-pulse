"use client";

import { motion } from "framer-motion";
import type { FormTone } from "@/lib/types";

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

export function AIPresence({ tone }: { tone: FormTone }) {
  const c = TONE[tone];

  return (
    <div className="relative flex items-center justify-center w-full h-full select-none">
      {/* Outermost breathing ring */}
      <motion.div
        className="absolute rounded-full"
        style={{ width: 320, height: 320, background: c.outer }}
        animate={{ scale: [1, 1.14, 1], opacity: [0.5, 0.9, 0.5] }}
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* Mid ring */}
      <motion.div
        className="absolute rounded-full"
        style={{ width: 210, height: 210, background: c.mid }}
        animate={{ scale: [1, 1.09, 1], opacity: [0.6, 1, 0.6] }}
        transition={{
          duration: 4.5,
          repeat: Infinity,
          ease: "easeInOut",
          delay: 0.6,
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
        animate={{ scale: [1, 1.06, 1] }}
        transition={{
          duration: 3.5,
          repeat: Infinity,
          ease: "easeInOut",
          delay: 0.3,
        }}
      />
    </div>
  );
}
