"use client";

import { motion } from "framer-motion";

interface ReflectionDistributionProps {
  copy: string;
  payload: Record<string, unknown>;
  hideHeadline?: boolean;
}

interface OptionColumn {
  label: string;
  count: number;
  isChosen: boolean;
}

// ── Layout / palette ─────────────────────────────────────────────────────────

const MAX_ROWS = 16;
const DOT_STEP = 16;
const DOT_SIZE = 12;
const COL_HEIGHT = MAX_ROWS * DOT_STEP + DOT_SIZE * 2 + 16;

// Terracotta orange matching reference image
const ORANGE = "#E04D18";
const ORANGE_LABEL = "#B83D10";
const GREY = "#DCDCE0";

// ── Helpers ──────────────────────────────────────────────────────────────────

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

function buildColumns(payload: Record<string, unknown>): OptionColumn[] {
  const chosen = typeof payload.chosen === "string" ? payload.chosen : "";
  const distribution = asDistribution(payload.distribution);

  return Object.entries(distribution)
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => ({
      label,
      count,
      isChosen: label === chosen,
    }));
}

function shortLabel(label: string): string {
  return label.length > 26 ? `${label.slice(0, 23)}...` : label;
}

// Properly centered: sub-columns are distributed symmetrically around 50%
function dotPosition(index: number, totalCount: number) {
  const row = index % MAX_ROWS;
  const col = Math.floor(index / MAX_ROWS);
  const totalCols = Math.max(1, Math.ceil(totalCount / MAX_ROWS));
  // Center all sub-columns: offset from center = (col - (totalCols-1)/2) * DOT_STEP
  const offset = (col - (totalCols - 1) / 2) * DOT_STEP;
  return {
    bottom: row * DOT_STEP,
    left: `calc(50% + ${offset}px - ${DOT_SIZE / 2}px)`,
  };
}

// ── Component ────────────────────────────────────────────────────────────────

export function ReflectionDistribution({
  copy,
  payload,
  hideHeadline = false,
}: ReflectionDistributionProps) {
  const columns = buildColumns(payload);

  return (
    <div className="relative flex min-h-[460px] w-full flex-col items-center justify-center overflow-hidden">
      {!hideHeadline && (
        <motion.h2
          className="max-w-md text-center text-2xl font-semibold leading-snug tracking-tight"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        >
          {copy}
        </motion.h2>
      )}

      <div
        className={`${hideHeadline ? "" : "mt-12"} flex w-full max-w-4xl items-end justify-center gap-10`}
      >
        {columns.map((column, columnIndex) => {
          const dots = Array.from({ length: column.count });

          return (
            <div
              key={column.label}
              className="flex min-w-0 flex-1 flex-col items-center gap-5"
            >
              <div
                className="relative w-full max-w-[220px]"
                style={{ height: COL_HEIGHT }}
              >
                {dots.map((_, dotIndex) => {
                  const pos = dotPosition(dotIndex, column.count);
                  const baseDelay = column.isChosen ? 0.45 : columnIndex * 0.06;
                  const span = 0.5;
                  const delay =
                    baseDelay +
                    (dotIndex / Math.max(1, column.count)) * span;

                  return (
                    <motion.span
                      key={dotIndex}
                      className="absolute rounded-full"
                      style={{
                        width: DOT_SIZE,
                        height: DOT_SIZE,
                        bottom: pos.bottom,
                        left: pos.left,
                        background: column.isChosen ? ORANGE : GREY,
                      }}
                      initial={{ opacity: 0, scale: 0.4 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{
                        delay,
                        duration: 0.28,
                        ease: "easeOut",
                      }}
                    />
                  );
                })}
              </div>

              <motion.p
                className="text-center"
                style={{
                  maxWidth: 200,
                  fontSize: 14,
                  lineHeight: 1.35,
                  color: column.isChosen
                    ? ORANGE_LABEL
                    : "rgba(110, 110, 120, 0.75)",
                  fontWeight: column.isChosen ? 500 : 400,
                }}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  delay: column.isChosen ? 1.2 : 0.4 + columnIndex * 0.06,
                  duration: 0.3,
                }}
                title={column.label}
              >
                {shortLabel(column.label)}
              </motion.p>

              {/* Mono count */}
              <motion.span
                className="font-mono tabular-nums"
                style={{
                  fontSize: 10,
                  letterSpacing: "0.1em",
                  color: column.isChosen
                    ? ORANGE_LABEL
                    : "rgba(120, 120, 130, 0.42)",
                  marginTop: -8,
                }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{
                  delay: column.isChosen ? 1.35 : 0.55 + columnIndex * 0.06,
                  duration: 0.3,
                }}
              >
                {String(column.count).padStart(2, "0")}
              </motion.span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
