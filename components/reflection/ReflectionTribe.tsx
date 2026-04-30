"use client";

import { motion } from "framer-motion";

interface ReflectionTribeProps {
  copy: string;
  quotes: string[];
  hideHeadline?: boolean;
}

function truncateQuote(quote: string): string {
  const clean = quote.trim();
  return clean.length > 100 ? `${clean.slice(0, 100)}...` : clean;
}

export function ReflectionTribe({ copy, quotes, hideHeadline = false }: ReflectionTribeProps) {
  const visibleQuotes = quotes.slice(0, 3);

  return (
    <div className="flex w-full flex-col items-center">
      {!hideHeadline && (
        <motion.h2
          className="max-w-md text-center text-2xl font-medium leading-snug text-foreground"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        >
          {copy}
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
