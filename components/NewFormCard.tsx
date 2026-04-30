"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { CARD_COLORS } from "@/lib/card-colors";

const STRIPES = [
  { color: "#16a34a", height: 48 }, // green  — tallest, bottom
  { color: "#2563eb", height: 40 }, // blue
  { color: "#ca8a04", height: 31 }, // amber
  { color: "#ea580c", height: 23 }, // orange
  { color: "#dc2626", height: 16 }, // red
  { color: "#db2777", height: 10 }, // pink   — shortest, top
];

export function NewFormCard({ index }: { index: number }) {
  // index is forms.length — that's what the next card's color index will be
  const ci = index % CARD_COLORS.length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.08, ease: "easeOut" }}
      whileHover={{ scale: 1.015, y: -2 }}
    >
      <Link
        href={`/create?ci=${ci}`}
        className="relative flex aspect-[3/4] cursor-pointer flex-col overflow-hidden rounded-xl shadow-sm"
        style={{ background: "#f5f4f0" }}
      >
        {/* Grain texture overlay */}
        <div
          className="pointer-events-none absolute inset-0 rounded-2xl"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
            backgroundSize: "180px 180px",
            opacity: 0.04,
            mixBlendMode: "overlay",
          }}
        />

        {/* Plus sign */}
        <div className="flex flex-1 items-center justify-center pb-10">
          <span
            className="select-none font-bold leading-none text-black/15"
            style={{ fontSize: "58px", lineHeight: 1 }}
          >
            +
          </span>
        </div>

        {/* Stacked colorful stripes — Zürich Card style */}
        {STRIPES.map(({ color, height }, i) => (
          <div
            key={i}
            className="pointer-events-none absolute left-0 right-0"
            style={{
              bottom: 0,
              height,
              background: color,
              borderRadius: "16px",
              zIndex: i + 1,
            }}
          />
        ))}
      </Link>
    </motion.div>
  );
}
