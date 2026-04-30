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

const MAX_ROWS = 12;
const DOT_STEP = 18;
const DOT_SIZE = 14;
const MARKER_SIZE = 18;
const COL_HEIGHT = MAX_ROWS * DOT_STEP + DOT_SIZE * 2 + 20;

const ORANGE = "#FF8C42";
const ORANGE_LABEL = "#C56F2E";
const GREY = "#D8D8DC";

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

function dotPosition(index: number) {
  const row = index % MAX_ROWS;
  const col = Math.floor(index / MAX_ROWS);
  return {
    bottom: row * DOT_STEP,
    left: `calc(50% + ${(col - 1) * DOT_STEP}px - ${DOT_SIZE / 2}px)`,
    col,
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
        className={`${hideHeadline ? "" : "mt-12"} flex w-full max-w-3xl items-end justify-center gap-7`}
      >
        {columns.map((column, columnIndex) => {
          const dots = Array.from({ length: column.count });
          const userDot = dotPosition(column.count);
          const markerColOffset = (userDot.col - 1) * DOT_STEP;

          return (
            <div
              key={column.label}
              className="flex min-w-0 flex-1 flex-col items-center gap-5"
            >
              <div
                className="relative w-full max-w-[140px]"
                style={{ height: COL_HEIGHT }}
              >
                {/* Solid filled dots — Bauhaus grid */}
                {dots.map((_, dotIndex) => {
                  const pos = dotPosition(dotIndex);
                  const baseDelay = column.isChosen ? 0.55 : columnIndex * 0.05;
                  const span = column.isChosen ? 0.55 : 0.4;
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
                      initial={{ opacity: 0, scale: 0.4, y: 4 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      transition={{
                        delay,
                        duration: 0.32,
                        ease: "easeOut",
                      }}
                    />
                  );
                })}

                {/* "You are here" marker */}
                {column.isChosen && (
                  <motion.div
                    className="absolute"
                    style={{
                      width: MARKER_SIZE,
                      height: MARKER_SIZE,
                      bottom: userDot.bottom + 6,
                      left: `calc(50% + ${markerColOffset}px - ${MARKER_SIZE / 2}px)`,
                    }}
                    initial={{ opacity: 0, scale: 0.2, y: -12 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    transition={{
                      delay: 1.4,
                      duration: 0.5,
                      type: "spring",
                      bounce: 0.5,
                    }}
                  >
                    {/* Continuous expanding halo ring */}
                    <motion.span
                      className="pointer-events-none absolute inset-0 rounded-full"
                      animate={{
                        boxShadow: [
                          "0 0 0 0 rgba(255, 140, 66, 0.5)",
                          "0 0 0 10px rgba(255, 140, 66, 0)",
                        ],
                      }}
                      transition={{
                        duration: 2.2,
                        repeat: Infinity,
                        ease: "easeOut",
                        delay: 1.9,
                      }}
                    />
                    {/* Solid orange core with subtle white inner highlight */}
                    <span
                      className="absolute inset-0 rounded-full"
                      style={{
                        background:
                          "radial-gradient(circle at 32% 28%, #FFE0C5 0%, #FF8C42 55%, #ED6F22 100%)",
                        boxShadow:
                          "0 0 12px 2px rgba(255, 140, 66, 0.42), inset 0 1px 1px rgba(255, 230, 200, 0.55)",
                      }}
                    />
                  </motion.div>
                )}
              </div>

              <motion.p
                className="text-center"
                style={{
                  maxWidth: 160,
                  fontSize: 14,
                  lineHeight: 1.3,
                  color: column.isChosen
                    ? ORANGE_LABEL
                    : "rgba(120, 120, 130, 0.78)",
                  fontWeight: column.isChosen ? 500 : 400,
                  letterSpacing: column.isChosen ? "-0.005em" : 0,
                }}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  delay: column.isChosen ? 1.6 : 0.4 + columnIndex * 0.05,
                  duration: 0.32,
                }}
                title={column.label}
              >
                {shortLabel(column.label)}
              </motion.p>

              {/* Mono count badge */}
              <motion.span
                className="font-mono tabular-nums"
                style={{
                  fontSize: 10,
                  letterSpacing: "0.1em",
                  color: column.isChosen
                    ? ORANGE_LABEL
                    : "rgba(120, 120, 130, 0.45)",
                  marginTop: -8,
                }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{
                  delay: column.isChosen ? 1.75 : 0.55 + columnIndex * 0.05,
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
