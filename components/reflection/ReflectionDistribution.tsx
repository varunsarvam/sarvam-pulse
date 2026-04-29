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

const MAX_ROWS = 18;
const DOT_STEP = 7;

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
  return label.length > 24 ? `${label.slice(0, 21)}...` : label;
}

function dotPosition(index: number) {
  const row = index % MAX_ROWS;
  const col = Math.floor(index / MAX_ROWS);
  return {
    bottom: row * DOT_STEP,
    left: `calc(50% + ${(col - 1) * DOT_STEP}px)`,
  };
}

export function ReflectionDistribution({
  copy,
  payload,
  hideHeadline = false,
}: ReflectionDistributionProps) {
  const columns = buildColumns(payload);

  return (
    <div className="relative flex min-h-[420px] w-full flex-col items-center justify-center overflow-hidden">
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

      <div className={`${hideHeadline ? "" : "mt-12"} flex w-full max-w-3xl items-end justify-center gap-5`}>
        {columns.map((column, columnIndex) => {
          const dots = Array.from({ length: column.count });
          const userDot = dotPosition(column.count);

          return (
            <div
              key={column.label}
              className="flex min-w-0 flex-1 flex-col items-center gap-3"
            >
              <div className="relative h-36 w-full max-w-[120px]">
                {dots.map((_, dotIndex) => {
                  const pos = dotPosition(dotIndex);
                  const delay =
                    (dotIndex / Math.max(1, column.count)) * 1.5 +
                    columnIndex * 0.05;

                  return (
                    <motion.span
                      key={dotIndex}
                      className={`absolute h-[5px] w-[5px] rounded-full ${
                        column.isChosen
                          ? "bg-violet-300/70 shadow-[0_0_8px_rgba(196,181,253,0.35)]"
                          : "bg-muted-foreground/25"
                      }`}
                      style={{
                        bottom: pos.bottom,
                        left: pos.left,
                      }}
                      initial={{ opacity: 0, scale: 0.4, y: 8 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      transition={{
                        delay,
                        duration: 0.22,
                        ease: "easeOut",
                      }}
                    />
                  );
                })}

                {column.isChosen && (
                  <motion.span
                    className="absolute h-2 w-2 rounded-full bg-violet-100 shadow-[0_0_14px_rgba(221,214,254,0.75)]"
                    style={{
                      bottom: userDot.bottom,
                      left: userDot.left,
                    }}
                    initial={{ opacity: 0, scale: 0.2, y: -16 }}
                    animate={{ opacity: 1, scale: [0.2, 1.35, 1], y: 0 }}
                    transition={{
                      delay: 1.55,
                      duration: 0.5,
                      ease: "easeOut",
                    }}
                  />
                )}
              </div>

              <p
                className={`max-w-[140px] text-center text-[11px] leading-tight ${
                  column.isChosen
                    ? "text-foreground/80"
                    : "text-muted-foreground/45"
                }`}
                title={column.label}
              >
                {shortLabel(column.label)}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
