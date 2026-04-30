"use client";

import Link from "next/link";
import { Check, Copy } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { useState } from "react";
import type { Form } from "@/lib/types";

interface FormCardProps {
  form: Form;
  responseCount: number;
  completedCount: number;
  index: number;
}

// Round-robin — index in the list determines color, never two the same on one page
const CARD_COLORS = [
  "#E8451A", // orange-red
  "#2233CC", // royal blue
  "#1A6B58", // teal
  "#7C3AED", // violet
  "#B45309", // amber-brown
  "#0F766E", // emerald
  "#BE185D", // rose
];

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

export function FormCard({
  form,
  responseCount,
  completedCount,
  index,
}: FormCardProps) {
  const [copied, setCopied] = useState(false);

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

  const bg = CARD_COLORS[index % CARD_COLORS.length];

  return (
    <motion.article
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.08, ease: "easeOut" }}
      whileHover={{ scale: 1.015, y: -2 }}
      className="relative flex aspect-[3/4] cursor-pointer flex-col overflow-hidden rounded-xl p-3 shadow-lg"
      style={{ background: bg }}
    >

      {/* Grain texture overlay */}
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

      {/* Spacer */}
      <div className="min-h-[10px] flex-1" />

      {/* Stats row */}
      <div className="mb-2 flex items-end justify-between">
        <div>
          <p className="font-mono text-xs font-bold leading-none text-white">
            {responseCount}
          </p>
          <p
            className="mt-0.5 font-mono text-[6px] uppercase tracking-widest"
            style={{ color: "rgba(255,255,255,0.55)" }}
          >
            responses
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-xs font-bold leading-none text-white">
            {completedCount}
          </p>
          <p
            className="mt-0.5 font-mono text-[6px] uppercase tracking-widest"
            style={{ color: "rgba(255,255,255,0.55)" }}
          >
            completed
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5">
        <Link
          href={`/respond/${form.id}`}
          className="flex flex-1 items-center justify-center rounded-lg py-1.5 text-[10px] font-semibold text-white transition-all hover:brightness-110"
          style={{
            background: "rgba(0,0,0,0.22)",
            backdropFilter: "blur(20px)",
            border: "1px solid rgba(255,255,255,0.14)",
          }}
        >
          Open →
        </Link>
        <button
          type="button"
          onClick={handleCopy}
          aria-label="Copy link"
          className="flex h-[26px] w-[26px] items-center justify-center rounded-lg transition-all hover:brightness-110"
          style={{
            background: "rgba(0,0,0,0.22)",
            backdropFilter: "blur(20px)",
            border: "1px solid rgba(255,255,255,0.14)",
          }}
        >
          {copied ? (
            <Check className="h-2 w-2 text-white" />
          ) : (
            <Copy className="h-2 w-2 text-white" />
          )}
        </button>
      </div>
    </motion.article>
  );
}
