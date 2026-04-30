"use client";

import { motion } from "framer-motion";

// ── Types ─────────────────────────────────────────────────────────────────────

interface QuoteEntry {
  text: string;
  /** 0–1 weight representing relative frequency among responses */
  weight: number;
}

interface FormInsightsCardProps {
  quotes: QuoteEntry[];
  stats: {
    mins: number;
    reactions: number;
    responded: number;
  };
}

// ── Blob stat badge ───────────────────────────────────────────────────────────

function BlobBadge({
  value,
  label,
  color,
  style,
  delay = 0,
}: {
  value: number;
  label: string;
  color: string;
  style?: React.CSSProperties;
  delay?: number;
}) {
  return (
    <motion.div
      className="absolute flex flex-col items-center justify-center"
      style={{
        width: 88,
        height: 88,
        borderRadius: "62% 38% 46% 54% / 60% 44% 56% 40%",
        background: color,
        ...style,
      }}
      initial={{ opacity: 0, scale: 0.7 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay, duration: 0.45, type: "spring", bounce: 0.35 }}
    >
      <span className="text-[28px] font-bold leading-none text-white tabular-nums">
        {value}
      </span>
      <span className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-white/80">
        {label}
      </span>
    </motion.div>
  );
}

// ── Quote row ─────────────────────────────────────────────────────────────────

function QuoteRow({
  entry,
  index,
}: {
  entry: QuoteEntry;
  index: number;
}) {
  const opacity = 0.18 + entry.weight * 0.82;
  const fontWeight = entry.weight > 0.65 ? 600 : entry.weight > 0.35 ? 500 : 400;
  const fontSize = entry.weight > 0.65 ? "1.05rem" : "0.9rem";

  return (
    <motion.p
      className="leading-snug text-gray-900 truncate"
      style={{ opacity, fontWeight, fontSize }}
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity, x: 0 }}
      transition={{ delay: 0.08 + index * 0.07, duration: 0.3, ease: "easeOut" }}
    >
      &ldquo;{entry.text}&rdquo;
    </motion.p>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function FormInsightsCard({ quotes, stats }: FormInsightsCardProps) {
  return (
    <motion.div
      className="relative overflow-hidden rounded-[28px] bg-white shadow-2xl"
      style={{ width: 520, minHeight: 340 }}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Quote list — left-side content, right side leaves room for blobs */}
      <div className="flex flex-col gap-3 px-8 py-7 pr-36">
        {quotes.map((entry, i) => (
          <QuoteRow key={i} entry={entry} index={i} />
        ))}
      </div>

      {/* Blob stats — bottom-right corner, overlapping */}
      <div className="pointer-events-none absolute bottom-0 right-0" style={{ width: 180, height: 180 }}>
        {/* Mins — top-right blob */}
        <BlobBadge
          value={stats.mins}
          label="Mins"
          color="linear-gradient(135deg, #4f6ef7 0%, #3b5bdb 100%)"
          style={{
            top: -10,
            right: -10,
            borderRadius: "55% 45% 60% 40% / 48% 58% 42% 52%",
          }}
          delay={0.2}
        />
        {/* Responded — bottom-right blob */}
        <BlobBadge
          value={stats.responded}
          label="Responded"
          color="linear-gradient(135deg, #7ec8e3 0%, #5bafd6 60%, #c07bd8 100%)"
          style={{
            bottom: 6,
            right: 2,
            borderRadius: "42% 58% 38% 62% / 56% 44% 60% 40%",
            width: 96,
            height: 96,
          }}
          delay={0.3}
        />
        {/* Reactions — bottom-left blob */}
        <BlobBadge
          value={stats.reactions}
          label="Reactions"
          color="linear-gradient(135deg, #8cc63f 0%, #6aa020 100%)"
          style={{
            bottom: 8,
            right: 84,
            borderRadius: "48% 52% 44% 56% / 60% 40% 58% 42%",
            width: 86,
            height: 86,
          }}
          delay={0.4}
        />
      </div>
    </motion.div>
  );
}
