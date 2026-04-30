"use client";

import { Check, Copy } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { FlutedGlass } from "@paper-design/shaders-react";
import { toast } from "sonner";
import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import type { Form } from "@/lib/types";
import { getCardColor } from "@/lib/card-colors";
import { updateFormAppearance } from "@/app/actions";

const APPEARANCES = [
  { image: "/paper-image.jpg" },
  { image: "/paper-image-orange.jpg" },
  { image: "/paper-image-green.jpg" },
  { image: "/paper-image-red.jpg" },
  { image: "/paper-image-yello.jpg" },
] as const;

interface FormCardProps {
  form: Form;
  responseCount: number;
  completedCount: number;
  index: number;
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

function ShaderThumb({
  image,
  selected,
  onClick,
  index,
}: {
  image: string;
  selected: boolean;
  onClick: () => void;
  index: number;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      initial={{ opacity: 0, y: 12, scale: 0.92 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.28, delay: index * 0.05, ease: [0.34, 1.4, 0.64, 1] }}
      className={
        "relative flex-1 overflow-hidden rounded-2xl transition-all duration-200 " +
        (selected
          ? "ring-[3px] ring-zinc-900 ring-offset-2 ring-offset-white"
          : "opacity-60 hover:opacity-90")
      }
      style={{ aspectRatio: "3/4" }}
    >
      <FlutedGlass
        width="100%"
        height="100%"
        image={image}
        colorBack="#ffffff00"
        colorShadow="#000133"
        colorHighlight="#0017ad"
        size={1}
        shadows={0}
        highlights={0}
        shape="pattern"
        angle={0}
        distortionShape="cascade"
        distortion={0.67}
        shift={0.7}
        stretch={0.2}
        blur={0.56}
        edges={0.56}
        margin={0}
        marginLeft={0}
        marginRight={0}
        marginTop={0}
        marginBottom={0}
        grainMixer={0.08}
        grainOverlay={0.15}
        scale={4}
        rotation={0}
        offsetX={-0.65}
        offsetY={0.55}
        fit="contain"
        originX={0}
        originY={0}
        minPixelRatio={2}
      />
      {selected && (
        <div className="absolute inset-0 flex items-end justify-center pb-3">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-white shadow-sm">
            <Check className="h-3.5 w-3.5 text-zinc-900" />
          </div>
        </div>
      )}
    </motion.button>
  );
}

function ThemeModal({
  appearance,
  onSelect,
  onClose,
}: {
  appearance: string;
  onSelect: (img: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(appearance);

  function handleOk() {
    onSelect(draft);
    onClose();
  }

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <AnimatePresence>
      <motion.div
        key="theme-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 z-[200] flex items-end justify-center sm:items-center"
        style={{ background: "rgba(255,255,255,0.85)", backdropFilter: "blur(18px)" }}
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, y: 32, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 32, scale: 0.96 }}
          transition={{ duration: 0.28, ease: [0.34, 1.2, 0.64, 1] }}
          className="w-full max-w-sm overflow-hidden rounded-t-3xl bg-white p-6 shadow-2xl sm:rounded-3xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="mb-5 flex items-center justify-between">
            <h2 className="font-display text-2xl text-zinc-900">Theme</h2>
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 transition-colors hover:bg-zinc-200"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {/* Shader cards */}
          <div className="flex gap-3">
            {APPEARANCES.map((opt, i) => (
              <ShaderThumb
                key={opt.image}
                image={opt.image}
                selected={draft === opt.image}
                onClick={() => setDraft(opt.image)}
                index={i}
              />
            ))}
          </div>

          {/* Actions */}
          <div className="mt-6 flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="font-matter flex-1 rounded-xl border border-zinc-200 py-3 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleOk}
              className="font-matter flex-[2] rounded-xl bg-zinc-900 py-3 text-sm font-medium text-white transition-colors hover:bg-zinc-800"
            >
              Apply
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}

export function FormCard({
  form,
  responseCount,
  completedCount,
  index,
}: FormCardProps) {
  const [copied, setCopied] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [appearance, setAppearance] = useState(form.appearance ?? "/paper-image.jpg");

  const bg = getCardColor(index);

  async function handleCopy(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const url = `${window.location.origin}/respond/${form.id}`;
    try {
      await copyText(url);
      setCopied(true);
      toast.success("Form link copied");
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Couldn't copy link");
    }
  }

  function handleCustomise(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setShowModal(true);
  }

  const handleApply = useCallback(async (image: string) => {
    setAppearance(image);
    try {
      await updateFormAppearance(form.id, image);
    } catch {
      toast.error("Couldn't update appearance");
    }
  }, [form.id]);

  return (
    <>
      <motion.article
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: index * 0.08, ease: "easeOut" }}
        whileHover={{ scale: 1.015, y: -2 }}
        onClick={() => window.location.href = `/respond/${form.id}`}
        className="relative flex aspect-[3/4] cursor-pointer flex-col overflow-hidden rounded-xl p-3 shadow-lg"
        style={{ background: bg }}
      >
        {/* Grain texture */}
        <div
          className="pointer-events-none absolute inset-0 rounded-2xl"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
            backgroundSize: "180px 180px",
            opacity: 0.055,
            mixBlendMode: "overlay",
          }}
        />

        {/* Title */}
        <h2
          className="mt-2.5 text-xl leading-[1.05] tracking-tight text-white"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {form.title}
        </h2>

        <div className="min-h-[10px] flex-1" />

        {/* Stats row */}
        <div className="mb-2 flex items-end justify-between">
          <div>
            <p className="font-mono text-xs font-bold leading-none text-white">{responseCount}</p>
            <p className="mt-0.5 font-mono text-[6px] uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.55)" }}>
              responses
            </p>
          </div>
          <div className="text-right">
            <p className="font-mono text-xs font-bold leading-none text-white">{completedCount}</p>
            <p className="mt-0.5 font-mono text-[6px] uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.55)" }}>
              completed
            </p>
          </div>
        </div>

        {/* Button row — icon copy + customise */}
        <div className="flex gap-1.5">
          {/* Icon-only copy */}
          <button
            type="button"
            onClick={handleCopy}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white transition-all hover:brightness-110"
            style={{
              background: "rgba(0,0,0,0.22)",
              backdropFilter: "blur(20px)",
              border: "1px solid rgba(255,255,255,0.14)",
            }}
            aria-label="Copy link"
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          </button>

          {/* Customise */}
          <button
            type="button"
            onClick={handleCustomise}
            className="flex flex-1 items-center justify-center rounded-lg py-1.5 text-[10px] font-semibold text-white transition-all hover:brightness-110"
            style={{
              background: "rgba(0,0,0,0.22)",
              backdropFilter: "blur(20px)",
              border: "1px solid rgba(255,255,255,0.14)",
            }}
          >
            Customise
          </button>
        </div>
      </motion.article>

      {showModal && (
        <ThemeModal
          appearance={appearance}
          onSelect={handleApply}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  );
}
