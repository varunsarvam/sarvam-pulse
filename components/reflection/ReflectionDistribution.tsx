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

const MAX_ROWS = 15;
const DOT_STEP = 16;
const DOT_SIZE = 10;
const MARKER_SIZE = 14;
const COL_HEIGHT = 280;

const AMBER = "#FFB680";
const AMBER_DEEP_TEXT = "#C56F2E";
const AMBER_GLOW = "rgba(255, 165, 90, 0.55)";
const RING_GREY = "rgba(0, 0, 0, 0.18)";

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
                {/* Atmospheric warm column glow — chosen only */}
                {column.isChosen && (
                  <motion.div
                    className="pointer-events-none absolute"
                    style={{
                      bottom: -10,
                      left: "calc(50% - 32px)",
                      width: 64,
                      height: COL_HEIGHT + 20,
                      background:
                        "radial-gradient(ellipse 48% 56% at 50% 55%, rgba(255, 165, 95, 0.18) 0%, rgba(255, 165, 95, 0.05) 55%, transparent 78%)",
                    }}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: [0.6, 1, 0.6] }}
                    transition={{
                      duration: 3.6,
                      repeat: Infinity,
                      ease: "easeInOut",
                      delay: 0.8,
                    }}
                  />
                )}

                {/* Dots */}
                {dots.map((_, dotIndex) => {
                  const pos = dotPosition(dotIndex);
                  const baseDelay = column.isChosen ? 0.7 : columnIndex * 0.06;
                  const span = column.isChosen ? 0.85 : 0.45;
                  const delay =
                    baseDelay +
                    (dotIndex / Math.max(1, column.count)) * span;

                  if (column.isChosen) {
                    return (
                      <motion.span
                        key={dotIndex}
                        className="absolute rounded-full"
                        style={{
                          width: DOT_SIZE,
                          height: DOT_SIZE,
                          bottom: pos.bottom,
                          left: pos.left,
                        }}
                        initial={{
                          opacity: 0,
                          scale: 0.3,
                          backgroundColor: "rgba(0, 0, 0, 0.12)",
                          boxShadow: "0 0 0 rgba(255, 165, 90, 0)",
                        }}
                        animate={{
                          opacity: 1,
                          scale: 1,
                          backgroundColor: AMBER,
                          boxShadow: `0 0 8px ${AMBER_GLOW}`,
                        }}
                        transition={{
                          delay,
                          duration: 0.5,
                          ease: "easeOut",
                        }}
                      />
                    );
                  }

                  return (
                    <motion.span
                      key={dotIndex}
                      className="absolute rounded-full"
                      style={{
                        width: DOT_SIZE,
                        height: DOT_SIZE,
                        bottom: pos.bottom,
                        left: pos.left,
                        border: `1.5px solid ${RING_GREY}`,
                        background: "transparent",
                      }}
                      initial={{ opacity: 0, scale: 0.4, y: 6 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      transition={{
                        delay,
                        duration: 0.24,
                        ease: "easeOut",
                      }}
                    />
                  );
                })}

                {/* Beacon marker — "you are here" */}
                {column.isChosen && (
                  <motion.div
                    className="absolute"
                    style={{
                      width: MARKER_SIZE,
                      height: MARKER_SIZE,
                      bottom: userDot.bottom + 4,
                      left: `calc(50% + ${markerColOffset}px - ${MARKER_SIZE / 2}px)`,
                    }}
                    initial={{ opacity: 0, scale: 0.2, y: -14 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    transition={{
                      delay: 1.7,
                      duration: 0.55,
                      type: "spring",
                      bounce: 0.5,
                    }}
                  >
                    {/* Continuous expanding halo ring */}
                    <motion.span
                      className="pointer-events-none absolute inset-0 rounded-full"
                      animate={{
                        boxShadow: [
                          "0 0 0 0 rgba(255, 160, 90, 0.55)",
                          "0 0 0 10px rgba(255, 160, 90, 0)",
                        ],
                      }}
                      transition={{
                        duration: 2.2,
                        repeat: Infinity,
                        ease: "easeOut",
                        delay: 2.3,
                      }}
                    />
                    {/* Core */}
                    <span
                      className="absolute inset-0 rounded-full"
                      style={{
                        background:
                          "radial-gradient(circle at 32% 28%, #FFF2DC 0%, #FFAF7A 45%, #FF8E48 95%)",
                        boxShadow:
                          "0 0 14px 3px rgba(255, 160, 90, 0.5), inset 0 1px 1px rgba(255, 240, 220, 0.6)",
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
                  color: column.isChosen ? AMBER_DEEP_TEXT : "rgba(120, 120, 130, 0.78)",
                  fontWeight: column.isChosen ? 500 : 400,
                  letterSpacing: column.isChosen ? "-0.005em" : 0,
                }}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  delay: column.isChosen ? 1.95 : 0.45 + columnIndex * 0.05,
                  duration: 0.32,
                }}
                title={column.label}
              >
                {shortLabel(column.label)}
              </motion.p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
