"use client";

import { motion } from "framer-motion";

interface ReflectionTribeProps {
  copy: string;
  quotes: string[];
}

function truncateQuote(quote: string): string {
  const clean = quote.trim();
  return clean.length > 100 ? `${clean.slice(0, 100)}...` : clean;
}

export function ReflectionTribe({ copy, quotes }: ReflectionTribeProps) {
  const visibleQuotes = quotes.slice(0, 3);

  return (
    <div className="flex w-full flex-col items-center">
      <motion.h2
        className="max-w-md text-center text-2xl font-medium leading-snug text-foreground"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
      >
        {copy}
      </motion.h2>

      <div className="mt-6 flex w-full max-w-md flex-col gap-3">
        {visibleQuotes.map((quote, index) => (
          <motion.div
            key={`${index}-${quote}`}
            className="rounded-xl border border-foreground/[0.1] bg-foreground/[0.07] px-5 py-3 shadow-sm"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.3 } }}
            transition={{
              delay: 0.6 + index * 0.3,
              duration: 0.4,
              ease: "easeOut",
            }}
          >
            <p className="text-sm italic leading-relaxed text-muted-foreground/90">
              &ldquo;{truncateQuote(quote)}&rdquo;
            </p>
            <p className="mt-2 text-xs text-muted-foreground/50">
              — anonymous
            </p>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
