"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import type { Question } from "@/lib/types";

interface TextInputProps {
  question: Question;
  onSubmit: (value: { type: "text"; value: string }) => void;
  disabled?: boolean;
  onTextChange?: (value: string) => void;
}

export function TextInput({
  question,
  onSubmit,
  disabled = false,
  onTextChange,
}: TextInputProps) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, [question.id]);

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (disabled) return;
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim().length > 3) {
      e.preventDefault();
      submit();
    }
  }

  function submit() {
    if (disabled) return;
    const trimmed = text.trim();
    if (trimmed.length <= 3) return;
    onSubmit({ type: "text", value: trimmed });
  }

  const showButton = text.trim().length > 3;

  return (
    <div className="relative flex w-full flex-col gap-4 pb-14">
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onTextChange?.(e.target.value);
        }}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        rows={5}
        placeholder="Take your time..."
        aria-label="Text answer"
        className="font-matter scrollbar-none min-h-[140px] max-h-[220px] w-full resize-none overflow-y-auto bg-transparent px-2 py-2 text-[1.15rem] font-medium leading-snug text-foreground outline-none placeholder:text-foreground/25 disabled:cursor-not-allowed md:min-h-[180px] md:max-h-[260px] md:text-[2rem]"
        style={{ caretColor: "#ff4d00" }}
      />

      <AnimatePresence>
        {showButton && (
          <motion.div
            className="absolute bottom-0 left-0"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.25, ease: "easeOut" as const }}
          >
            <Button
              variant="ghost"
              onClick={submit}
              size="lg"
              className="group relative isolate h-10 overflow-hidden rounded-full bg-[#111820] px-5 text-sm font-medium text-white shadow-none transition-transform hover:scale-[1.03] hover:bg-[#0b1118] hover:text-white disabled:opacity-45"
              disabled={disabled}
            >
              <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_24%_12%,rgba(255,255,255,0.16),transparent_30%),linear-gradient(135deg,rgba(255,255,255,0.08),transparent_45%)]" />
              <span className="pointer-events-none absolute -left-12 top-0 h-full w-12 -skew-x-12 bg-white/30 blur-lg transition-transform duration-700 group-hover:translate-x-48" />
              <span className="relative z-10">Send →</span>
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
