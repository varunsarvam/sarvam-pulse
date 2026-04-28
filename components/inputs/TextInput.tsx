"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import type { Question } from "@/lib/types";

interface TextInputProps {
  question: Question;
  onSubmit: (value: { type: "text"; value: string }) => void;
}

export function TextInput({ question, onSubmit }: TextInputProps) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, [question.id]);

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim().length > 3) {
      e.preventDefault();
      submit();
    }
  }

  function submit() {
    const trimmed = text.trim();
    if (trimmed.length <= 3) return;
    onSubmit({ type: "text", value: trimmed });
  }

  const showButton = text.trim().length > 3;

  return (
    <div className="flex flex-col gap-4 w-full">
      <div className="relative rounded-2xl border border-border bg-muted/30 focus-within:border-foreground/30 transition-colors duration-200">
        <textarea
          ref={ref}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Take your time..."
          rows={5}
          className="w-full resize-none rounded-2xl bg-transparent px-5 py-4 text-base leading-relaxed text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
        />
      </div>

      <div className="flex items-center justify-between min-h-[40px]">
        <p className="text-xs text-muted-foreground/60 select-none">
          {showButton ? (
            <>
              <kbd className="font-mono">⌘</kbd>
              <span> + </span>
              <kbd className="font-mono">↵</kbd>
              <span> to send</span>
            </>
          ) : (
            text.length > 0 && "Keep going…"
          )}
        </p>

        <AnimatePresence>
          {showButton && (
            <motion.div
              initial={{ opacity: 0, scale: 0.88, y: 6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.88, y: 6 }}
              transition={{ duration: 0.2, ease: "easeOut" as const }}
            >
              <Button onClick={submit} size="sm" className="px-5">
                Send →
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
