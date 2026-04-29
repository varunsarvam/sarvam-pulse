"use client";

import Link from "next/link";
import { Check, Copy } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { Form, FormTone } from "@/lib/types";

interface FormCardProps {
  form: Form;
  responseCount: number;
  completedCount: number;
  index: number;
}

const TONE_BADGE: Record<FormTone, string> = {
  playful: "bg-orange-500/10 text-orange-500 ring-orange-500/20",
  calm: "bg-blue-500/10 text-blue-500 ring-blue-500/20",
  direct: "bg-zinc-500/10 text-zinc-500 ring-zinc-500/20",
  insightful: "bg-violet-500/10 text-violet-500 ring-violet-500/20",
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

  async function handleCopy() {
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

  return (
    <motion.article
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.08, ease: "easeOut" }}
      whileHover={{ y: -4 }}
      className="group flex min-h-[260px] flex-col justify-between rounded-3xl border border-border bg-card/70 p-6 shadow-sm transition-shadow hover:border-foreground/15 hover:shadow-xl"
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <span
            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${TONE_BADGE[form.tone]}`}
          >
            {form.tone}
          </span>
          <span className="text-xs text-muted-foreground">
            {form.status}
          </span>
        </div>

        <div className="space-y-2">
          <h2 className="line-clamp-2 text-xl font-medium leading-snug tracking-tight">
            {form.title}
          </h2>
          <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">
            {form.intent || "No intent added yet."}
          </p>
        </div>

        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>{responseCount} response{responseCount === 1 ? "" : "s"}</span>
          <span className="h-1 w-1 rounded-full bg-muted-foreground/40" />
          <span>{completedCount} completed</span>
        </div>
      </div>

      <div className="mt-8 flex items-center gap-3">
        <Button asChild className="flex-1">
          <Link href={`/respond/${form.id}`}>Open form →</Link>
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={handleCopy}
          className="gap-2"
        >
          {copied ? (
            <Check className="h-4 w-4" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
          {copied ? "Copied!" : "Copy link"}
        </Button>
      </div>
    </motion.article>
  );
}
