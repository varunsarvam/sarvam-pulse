"use client";

import Link from "next/link";
import { motion } from "framer-motion";

const STRIPES = [
  { color: "#16a34a", height: 80 }, // green  — tallest, bottom
  { color: "#2563eb", height: 66 }, // blue
  { color: "#ca8a04", height: 52 }, // amber
  { color: "#ea580c", height: 38 }, // orange
  { color: "#dc2626", height: 26 }, // red
  { color: "#db2777", height: 16 }, // pink   — shortest, top
];

export function NewFormCard({ index }: { index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.08, ease: "easeOut" }}
      whileHover={{ scale: 1.015, y: -2 }}
    >
      <Link
        href="/create"
        className="relative flex min-h-[260px] cursor-pointer flex-col overflow-hidden rounded-2xl shadow-sm"
        style={{ background: "#f5f4f0" }}
      >
        {/* Plus sign */}
        <div className="flex flex-1 items-center justify-center pb-10">
          <span
            className="select-none font-bold leading-none text-black/15"
            style={{ fontSize: "96px", lineHeight: 1 }}
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
