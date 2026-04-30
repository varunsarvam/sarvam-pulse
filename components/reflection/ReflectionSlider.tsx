"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import Lottie from "lottie-react";

function useLottieData(url: string) {
  const [data, setData] = useState<object | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(url)
      .then((r) => r.json())
      .then((json) => { if (!cancelled) setData(json); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [url]);
  return data;
}

// ── EmojiSlider step values → exact Noto hex codes ───────────────────────────
// Must match EmojiSlider STEPS exactly so the big emoji reflects what was picked

const VALUE_HEX: Record<number, string> = {
  0:   "1f621", // 😡 Strongly disagree
  20:  "1f61e", // 😞 Disagree
  40:  "1f615", // 😕 Not sure
  60:  "1f642", // 🙂 Agree
  80:  "1f60a", // 😊 Strongly agree
  100: "1f929", // 🤩 Absolutely!
};

// For the rising particles: distribution is stored as range buckets ("0-20" etc.)
// Map each bucket to the emoji of its representative step value
const BUCKETS = ["0-20", "20-40", "40-60", "60-80", "80-100"] as const;

const BUCKET_EMOJI: Record<(typeof BUCKETS)[number], string> = {
  "0-20":   "😡",
  "20-40":  "😞",
  "40-60":  "😕",
  "60-80":  "🙂",
  "80-100": "😊",
};

function notoUrl(hex: string) {
  return `https://fonts.gstatic.com/s/e/notoemoji/latest/${hex}/lottie.json`;
}

// Resolve the exact hex for the user's chosen value.
// Snaps to the nearest valid step if value is somehow off-grid.
function resolveUserHex(value: number): string {
  if (VALUE_HEX[value]) return VALUE_HEX[value];
  const nearest = [0, 20, 40, 60, 80, 100].reduce((a, b) =>
    Math.abs(b - value) < Math.abs(a - value) ? b : a
  );
  return VALUE_HEX[nearest];
}

interface ReflectionSliderProps {
  copy: string;
  payload: Record<string, unknown>;
  hideHeadline?: boolean;
}

interface Particle {
  id: string;
  emoji: string;
  x: number;
  delay: number;
  duration: number;
  size: number;
  sway: number;
}

function seeded(seed: number): number {
  const x = Math.sin(seed * 127.1 + 31.7) * 10000;
  return x - Math.floor(x);
}

function asDistribution(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, number> = {};
  for (const [key, count] of Object.entries(value as Record<string, unknown>)) {
    if (typeof count === "number" && Number.isFinite(count) && count > 0) {
      out[key] = count;
    }
  }
  return out;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

// Build rising particles proportional to the population distribution.
// Each bucket maps to its actual emoji so particles reflect how others answered.
function makeParticles(distribution: Record<string, number>): Particle[] {
  const total = BUCKETS.reduce((sum, b) => sum + (distribution[b] ?? 0), 0);
  if (total <= 0) return [];

  const target = clamp(total, 20, 40);
  const rawCounts = BUCKETS.map((bucket) => ({
    bucket,
    exact: ((distribution[bucket] ?? 0) / total) * target,
  }));
  const counts = rawCounts.map((item) => ({
    ...item,
    count: Math.floor(item.exact),
    remainder: item.exact - Math.floor(item.exact),
  }));

  let assigned = counts.reduce((sum, item) => sum + item.count, 0);
  for (const item of counts.filter((c) => (distribution[c.bucket] ?? 0) > 0)) {
    if (item.count === 0 && assigned < target) { item.count = 1; assigned++; }
  }
  while (assigned < target) {
    const next = counts
      .filter((item) => (distribution[item.bucket] ?? 0) > 0)
      .sort((a, b) => b.remainder - a.remainder)[assigned % counts.length];
    if (!next) break;
    next.count++; assigned++;
  }

  const particles: Particle[] = [];
  let idx = 0;
  for (const item of counts) {
    for (let i = 0; i < item.count; i++) {
      particles.push({
        id: `${item.bucket}-${i}`,
        emoji: BUCKET_EMOJI[item.bucket],
        x: 4 + seeded(idx + 1) * 92,
        delay: seeded(idx + 20) * 1.2,
        duration: 2.8 + seeded(idx + 40) * 1.4,
        size: 22 + seeded(idx + 60) * 14,
        sway: -22 + seeded(idx + 80) * 44,
      });
      idx++;
    }
  }
  return particles.slice(0, 40);
}

export function ReflectionSlider({ copy, payload, hideHeadline = false }: ReflectionSliderProps) {
  const distribution = asDistribution(payload.distribution);
  const particles = makeParticles(distribution);
  const value = typeof payload.value === "number" ? payload.value : 50;
  const hex = resolveUserHex(value);
  const lottieData = useLottieData(notoUrl(hex));

  return (
    <div
      className="relative w-full overflow-hidden"
      style={{
        minHeight: 380,
        maskImage: "linear-gradient(to top, black 0%, black 60%, transparent 100%)",
        WebkitMaskImage: "linear-gradient(to top, black 0%, black 60%, transparent 100%)",
      }}
    >
      {!hideHeadline && (
        <motion.h2
          className="absolute left-1/2 top-[18%] z-20 max-w-md -translate-x-1/2 text-center text-2xl font-semibold leading-snug tracking-tight"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        >
          {copy}
        </motion.h2>
      )}

      {/* Rising particles — emojis proportional to how the population answered */}
      <div className="pointer-events-none absolute inset-0 z-0">
        {particles.map((particle, i) => (
          <motion.span
            key={particle.id}
            className="absolute select-none"
            style={{
              left: `${particle.x}%`,
              bottom: 0,
              fontSize: particle.size,
            }}
            initial={{ opacity: 0, y: 0, x: 0, scale: 0.8 }}
            animate={{
              opacity: [0, 0.85, 0.65, 0],
              y: -520,
              x: [0, particle.sway, 0],
              scale: [0.8, 1.05, 0.9],
            }}
            transition={{
              delay: particle.delay,
              duration: particle.duration,
              ease: "easeOut",
              times: [0, 0.15, 0.7, 1],
              repeat: Infinity,
              repeatDelay: seeded(i + 99) * 1.5,
            }}
          >
            {particle.emoji}
          </motion.span>
        ))}
      </div>

      {/* Big Lottie emoji — exactly the one the user picked */}
      <motion.div
        className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2"
        initial={{ opacity: 0, scale: 0.4 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.3, duration: 0.55, type: "spring", bounce: 0.4 }}
      >
        {lottieData && (
          <Lottie
            animationData={lottieData}
            style={{ width: 130, height: 130 }}
            loop
            autoplay
          />
        )}
      </motion.div>
    </div>
  );
}
