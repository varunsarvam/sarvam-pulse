"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import type { Question } from "@/lib/types";

interface VisualOption {
  label: string;
  image_url: string;
}

interface VisualSelectProps {
  question: Question;
  options: VisualOption[];
  onSubmit: (value: { type: "visual_select"; value: string }) => void;
  disabled?: boolean;
}

// Soft tints used when the image URL is missing or fails to load. Cycled by
// option index so adjacent cards don't share a colour.
const FALLBACK_TINTS = [
  { from: "#fde9d9", to: "#f6c9aa" }, // peach
  { from: "#dfe7fb", to: "#bcccf3" }, // periwinkle
  { from: "#e3f1e3", to: "#bedabe" }, // sage
  { from: "#f5dbe7", to: "#e6b9cf" }, // rose
  { from: "#efe6f5", to: "#d9c8e7" }, // lilac
  { from: "#fbf0d3", to: "#ecd697" }, // butter
];

function VisualOptionCard({
  opt,
  index,
  isSelected,
  isDimmed,
  disabled,
  onClick,
}: {
  opt: VisualOption;
  index: number;
  isSelected: boolean;
  isDimmed: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const tint = useMemo(
    () => FALLBACK_TINTS[index % FALLBACK_TINTS.length],
    [index]
  );

  // Treat missing / `placeholder.test` / `placeholder.com` URLs as no-image
  // up front so we don't even attempt the network round-trip. The pipeline's
  // visual_select images aren't real yet (Stage A returns
  // https://placeholder.test/<slug>.png).
  const url = opt.image_url?.trim();
  const isPlaceholder =
    !url || /^https?:\/\/placeholder\.(test|com)/i.test(url);
  const showImage = !isPlaceholder && !imgFailed;

  return (
    <motion.button
      onClick={onClick}
      disabled={disabled}
      animate={
        isSelected
          ? { scale: 1.04, opacity: 1 }
          : isDimmed
            ? { scale: 0.96, opacity: 0.35 }
            : { scale: 1, opacity: 1 }
      }
      whileHover={!disabled ? { scale: 1.02 } : {}}
      whileTap={!disabled ? { scale: 0.97 } : {}}
      transition={{ type: "spring", stiffness: 340, damping: 26 }}
      className="group relative flex flex-col overflow-hidden rounded-xl border bg-card text-left shadow-sm disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={{
        borderColor: isSelected
          ? "hsl(var(--foreground) / 0.8)"
          : "hsl(var(--border))",
        borderWidth: isSelected ? 2 : 1,
      }}
    >
      {/* Image — or soft tint card when the URL is a placeholder / fails */}
      <div
        className="relative aspect-square w-full overflow-hidden"
        style={
          showImage
            ? undefined
            : {
                background: `linear-gradient(135deg, ${tint.from}, ${tint.to})`,
              }
        }
      >
        {showImage && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt=""
            onError={() => setImgFailed(true)}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        )}

        {/* Selection checkmark overlay */}
        {isSelected && (
          <motion.div
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: "spring", stiffness: 400, damping: 22 }}
            className="absolute inset-0 flex items-center justify-center bg-foreground/10"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-foreground text-background text-sm font-bold shadow">
              ✓
            </span>
          </motion.div>
        )}
      </div>

      {/* Label — always shown, regardless of image state */}
      <div className="px-2.5 py-2">
        <p className="truncate text-xs font-medium text-card-foreground">
          {opt.label}
        </p>
      </div>
    </motion.button>
  );
}

export function VisualSelect({
  question,
  options,
  onSubmit,
  disabled = false,
}: VisualSelectProps) {
  const [selected, setSelected] = useState<string | null>(null);

  void question;

  // 3 or more options → 3-col grid; 1–2 → side by side
  const cols = options.length >= 3 ? "grid-cols-3" : "grid-cols-2";

  function pick(label: string) {
    if (disabled || selected !== null) return;
    setSelected(label);
    setTimeout(() => onSubmit({ type: "visual_select", value: label }), 80);
  }

  return (
    <div className={`grid ${cols} gap-3 w-full`}>
      {options.map((opt, i) => (
        <VisualOptionCard
          key={opt.label}
          opt={opt}
          index={i}
          isSelected={selected === opt.label}
          isDimmed={selected !== null && selected !== opt.label}
          disabled={disabled || selected !== null}
          onClick={() => pick(opt.label)}
        />
      ))}
    </div>
  );
}
