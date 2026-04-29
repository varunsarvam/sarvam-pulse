"use client";

import { motion } from "framer-motion";

const BUCKETS = ["0-20", "20-40", "40-60", "60-80", "80-100"] as const;

const BUCKET_EMOJI: Record<(typeof BUCKETS)[number], string> = {
  "0-20": "😞",
  "20-40": "😕",
  "40-60": "😐",
  "60-80": "🙂",
  "80-100": "😄",
};

interface ReflectionSliderProps {
  copy: string;
  payload: Record<string, unknown>;
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

function userEmoji(value: number): string {
  const bucket = value >= 100 ? "80-100" : `${Math.floor(value / 20) * 20}-${Math.floor(value / 20) * 20 + 20}`;
  return BUCKET_EMOJI[bucket as keyof typeof BUCKET_EMOJI] ?? "😐";
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
    if (item.count === 0 && assigned < target) {
      item.count = 1;
      assigned++;
    }
  }

  while (assigned < target) {
    const next = counts
      .filter((item) => (distribution[item.bucket] ?? 0) > 0)
      .sort((a, b) => b.remainder - a.remainder)[assigned % counts.length];
    if (!next) break;
    next.count++;
    assigned++;
  }

  const particles: Particle[] = [];
  let idx = 0;
  for (const item of counts) {
    for (let i = 0; i < item.count; i++) {
      particles.push({
        id: `${item.bucket}-${i}`,
        emoji: BUCKET_EMOJI[item.bucket],
        x: 4 + seeded(idx + 1) * 92,
        delay: seeded(idx + 20) * 1,
        duration: 3 + seeded(idx + 40) * 1,
        size: 18 + seeded(idx + 60) * 12,
        sway: -18 + seeded(idx + 80) * 36,
      });
      idx++;
    }
  }

  return particles.slice(0, 40);
}

export function ReflectionSlider({ copy, payload }: ReflectionSliderProps) {
  const distribution = asDistribution(payload.distribution);
  const particles = makeParticles(distribution);
  const value = typeof payload.value === "number" ? payload.value : 50;
  const userBottom = `${clamp(12 + value * 0.7, 12, 82)}%`;

  return (
    <div className="relative min-h-[460px] w-full overflow-hidden">
      <motion.h2
        className="absolute left-1/2 top-[28%] z-20 max-w-md -translate-x-1/2 text-center text-2xl font-semibold leading-snug tracking-tight"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
      >
        {copy}
      </motion.h2>

      <div className="pointer-events-none absolute inset-0 z-0">
        {particles.map((particle) => (
          <motion.span
            key={particle.id}
            className="absolute bottom-[-12%] select-none"
            style={{
              left: `${particle.x}%`,
              fontSize: particle.size,
              filter: "saturate(0.85)",
            }}
            initial={{ opacity: 0, y: 0, x: 0, scale: 0.85 }}
            animate={{
              opacity: [0, 0.72, 0.55, 0],
              y: -520,
              x: [0, particle.sway, 0],
              scale: [0.85, 1, 0.94],
            }}
            transition={{
              delay: particle.delay,
              duration: particle.duration,
              ease: "easeOut",
              times: [0, 0.2, 0.72, 1],
            }}
          >
            {particle.emoji}
          </motion.span>
        ))}
      </div>

      <motion.div
        className="absolute left-1/2 z-10 -translate-x-1/2 select-none rounded-full bg-background/80 px-3 py-2 shadow-[0_0_30px_rgba(255,255,255,0.12)] backdrop-blur"
        style={{ bottom: userBottom }}
        initial={{ opacity: 0, scale: 0.7 }}
        animate={{ opacity: 1, scale: 1.5 }}
        transition={{ delay: 0.4, duration: 0.5, type: "spring", bounce: 0.35 }}
      >
        <span className="text-4xl drop-shadow-[0_0_16px_rgba(255,255,255,0.4)]">
          {userEmoji(value)}
        </span>
      </motion.div>
    </div>
  );
}
