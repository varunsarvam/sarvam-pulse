"use client";

import { motion } from "framer-motion";

interface ReflectionTribeProps {
  copy: string;
  quotes: string[];
  hideHeadline?: boolean;
  /** TTS-typewriter-revealed text — overrides `copy` while audio is playing. */
  displayText?: string;
}

function truncateQuote(quote: string): string {
  const clean = quote.trim();
  return clean.length > 100 ? `${clean.slice(0, 100)}...` : clean;
}

export function ReflectionTribe({ copy, quotes, hideHeadline = false, displayText }: ReflectionTribeProps) {
  const visibleQuotes = quotes.slice(0, 3);
  // Phase 6.5d: explicit-undefined check so an empty `displayText` from the
  // parent (the "loading" placeholder state) renders as empty rather than
  // falling through to `copy`. Standalone callers that don't pass the prop
  // still get the legacy `copy` fallback.
  const headlineText = displayText !== undefined ? displayText : copy;

  return (
    <div className="flex w-full flex-col items-center">
      {!hideHeadline && (
        <motion.h2
          className="max-w-md text-center text-2xl font-medium leading-snug text-foreground"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        >
          {headlineText}
        </motion.h2>
      )}

      <div className={`${hideHeadline ? "" : "mt-6"} flex w-full max-w-md flex-col gap-3`}>
        {visibleQuotes.map((quote, index) => (
          <motion.div
            key={`${index}-${quote}`}
            className="rounded-2xl border border-zinc-200 bg-white px-5 py-4"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.3 } }}
            transition={{
              delay: 0.6 + index * 0.3,
              duration: 0.4,
              ease: "easeOut",
            }}
          >
            <p className="text-sm leading-relaxed text-zinc-700">
              &ldquo;{truncateQuote(quote)}&rdquo;
            </p>
            <p className="mt-2 text-xs text-zinc-400">
              — anonymous
            </p>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
