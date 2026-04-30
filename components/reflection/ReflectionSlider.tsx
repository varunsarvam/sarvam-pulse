"use client";

import { motion } from "framer-motion";
import Lottie from "lottie-react";

const BUCKETS = ["0-20", "20-40", "40-60", "60-80", "80-100"] as const;

const BUCKET_EMOJI: Record<(typeof BUCKETS)[number], string> = {
  "0-20":   "😞",
  "20-40":  "😕",
  "40-60":  "😐",
  "60-80":  "🙂",
  "80-100": "😄",
};

// Noto animated emoji hex codes matching each bucket
const BUCKET_HEX: Record<(typeof BUCKETS)[number], string> = {
  "0-20":   "1f61e",
  "20-40":  "1f615",
  "40-60":  "1f610",
  "60-80":  "1f642",
  "80-100": "1f604",
};

function notoUrl(hex: string) {
  return `https://fonts.gstatic.com/s/e/notoemoji/latest/${hex}/lottie.json`;
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

function userBucket(value: number): (typeof BUCKETS)[number] {
  const key = value >= 100 ? "80-100" : `${Math.floor(value / 20) * 20}-${Math.floor(value / 20) * 20 + 20}`;
  return (BUCKET_HEX[key as keyof typeof BUCKET_HEX] ? key : "40-60") as (typeof BUCKETS)[number];
}

function makeParticles(distribution: Record<string, number>): Particle[] {
  const total = BUCKETS.reduce((sum, bucket) => sum + (distribution[bucket] ?? 0), 0);
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
  const bucket = userBucket(value);
  const hex = BUCKET_HEX[bucket];

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

      {/* Rising emoji particles — start at card bottom, exit card top */}
      <div className="pointer-events-none absolute inset-0 z-0">
        {particles.map((particle) => (
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
              repeatDelay: seeded(particles.indexOf(particle) + 99) * 1.5,
            }}
          >
            {particle.emoji}
          </motion.span>
        ))}
      </div>

      {/* Big animated Lottie emoji — centered */}
      <motion.div
        className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2"
        initial={{ opacity: 0, scale: 0.4 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.3, duration: 0.55, type: "spring", bounce: 0.4 }}
      >
        <Lottie
          path={notoUrl(hex)}
          style={{ width: 130, height: 130 }}
          loop
          autoplay
        />
      </motion.div>
    </div>
  );
}
