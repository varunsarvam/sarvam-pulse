"use client";

import Link from "next/link";
import { Check, Copy } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { useState } from "react";
import type { Form, FormTone } from "@/lib/types";

interface FormCardProps {
  form: Form;
  responseCount: number;
  completedCount: number;
  index: number;
}

const TONE_BG: Record<FormTone, string> = {
  playful:   "#E8451A",
  calm:      "#2233CC",
  direct:    "#1A6B58",
  insightful:"#5B2A8E",
};

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

  const bg = TONE_BG[form.tone];

  return (
    <motion.article
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.08, ease: "easeOut" }}
      whileHover={{ scale: 1.015, y: -2 }}
      className="relative flex aspect-[3/4] cursor-pointer flex-col overflow-hidden rounded-2xl p-5 shadow-lg"
      style={{ background: bg }}
    >

      {/* Title */}
      <h2
        className="mt-4 text-4xl leading-[1.05] tracking-tight text-white"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {form.title}
      </h2>

      {/* Spacer */}
      <div className="min-h-[20px] flex-1" />

      {/* Stats row */}
      <div className="mb-3 flex items-end justify-between">
        <div>
          <p className="font-mono text-base font-bold leading-none text-white">
            {responseCount}
          </p>
          <p
            className="mt-0.5 font-mono text-[9px] uppercase tracking-widest"
            style={{ color: "rgba(255,255,255,0.55)" }}
          >
            responses
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-base font-bold leading-none text-white">
            {completedCount}
          </p>
          <p
            className="mt-0.5 font-mono text-[9px] uppercase tracking-widest"
            style={{ color: "rgba(255,255,255,0.55)" }}
          >
            completed
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <Link
          href={`/respond/${form.id}`}
          className="flex flex-1 items-center justify-center rounded-2xl py-3 text-sm font-semibold text-white transition-all hover:brightness-110"
          style={{
            background: "rgba(0,0,0,0.22)",
            backdropFilter: "blur(20px)",
            border: "1px solid rgba(255,255,255,0.14)",
          }}
        >
          Open form →
        </Link>
        <button
          type="button"
          onClick={handleCopy}
          aria-label="Copy link"
          className="flex h-[46px] w-[46px] items-center justify-center rounded-2xl transition-all hover:brightness-110"
          style={{
            background: "rgba(0,0,0,0.22)",
            backdropFilter: "blur(20px)",
            border: "1px solid rgba(255,255,255,0.14)",
          }}
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-white" />
          ) : (
            <Copy className="h-3.5 w-3.5 text-white" />
          )}
        </button>
      </div>
    </motion.article>
  );
}
