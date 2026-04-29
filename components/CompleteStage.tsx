"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { Copy, Download, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ShareCard } from "@/components/ShareCard";
import type { Form } from "@/lib/types";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Identity {
  label: string;
  summary: string;
  highlights: string[];
}

interface Percentile {
  question_id: string;
  question_prompt: string;
  user_value: number;
  percentile: number;
}

type Phase =
  | "loading"
  | "intro"
  | "label"
  | "summary"
  | "highlights"
  | "percentiles"
  | "share";

const PHASE_DURATIONS: Record<Exclude<Phase, "loading" | "share">, number> = {
  intro: 1500,
  label: 2200,
  summary: 2500,
  highlights: 2500,
  percentiles: 1800,
};

// ─── Loading shimmer ──────────────────────────────────────────────────────────

function LoadingShimmer() {
  return (
    <div className="flex flex-col items-center gap-6 w-full max-w-md">
      <motion.p
        className="text-xs font-medium tracking-widest uppercase text-muted-foreground"
        animate={{ opacity: [0.4, 1, 0.4] }}
        transition={{ duration: 1.6, repeat: Infinity }}
      >
        Reading your answers…
      </motion.p>

      {/* Shimmer card */}
      <div className="relative w-full h-48 rounded-2xl bg-muted/30 overflow-hidden">
        <motion.div
          className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent"
          animate={{ x: ["-100%", "100%"] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: "linear" }}
        />
      </div>

      {/* Three pulsing dots */}
      <div className="flex gap-2">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="h-2 w-2 rounded-full bg-muted-foreground/50"
            animate={{ opacity: [0.3, 1, 0.3], y: [0, -3, 0] }}
            transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.2 }}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Animated label ────────────────────────────────────────────────────────────

function AnimatedLabel({ label }: { label: string }) {
  const words = label.split(" ");
  return (
    <h1 className="text-5xl md:text-6xl font-bold tracking-tight leading-tight text-center">
      {words.map((w, i) => (
        <motion.span
          key={i}
          className="inline-block mr-3 last:mr-0"
          initial={{ scale: 0.8, opacity: 0, y: 12 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          transition={{
            duration: 0.55,
            delay: i * 0.18,
            ease: [0.16, 1, 0.3, 1],
          }}
        >
          {w}
        </motion.span>
      ))}
    </h1>
  );
}

// ─── Typewriter summary ────────────────────────────────────────────────────────

function TypewriterSummary({ text }: { text: string }) {
  const [shown, setShown] = useState("");
  useEffect(() => {
    let i = 0;
    const id = setInterval(() => {
      i++;
      setShown(text.slice(0, i));
      if (i >= text.length) clearInterval(id);
    }, 22);
    return () => clearInterval(id);
  }, [text]);

  return (
    <p className="text-lg text-muted-foreground leading-relaxed text-center max-w-md">
      {shown}
      <motion.span
        className="inline-block ml-0.5 w-[2px] h-5 bg-foreground/60 align-middle"
        animate={{ opacity: [1, 0, 1] }}
        transition={{ duration: 0.9, repeat: Infinity }}
      />
    </p>
  );
}

// ─── Highlight cards ───────────────────────────────────────────────────────────

function HighlightCards({ highlights }: { highlights: string[] }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 w-full max-w-2xl">
      {highlights.map((h, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, y: 18, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{
            duration: 0.45,
            delay: i * 0.4,
            ease: [0.16, 1, 0.3, 1],
          }}
          className="rounded-xl border border-border bg-card/60 backdrop-blur p-3 text-xs text-foreground/90 leading-relaxed"
        >
          <span className="text-[10px] text-muted-foreground/70 mr-2">
            {String(i + 1).padStart(2, "0")}
          </span>
          {h}
        </motion.div>
      ))}
    </div>
  );
}

// ─── Percentile bars ───────────────────────────────────────────────────────────

function PercentileBars({ percentiles }: { percentiles: Percentile[] }) {
  if (percentiles.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic">
        No slider questions to compare.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-4 w-full max-w-md">
      {percentiles.map((p, i) => (
        <motion.div
          key={p.question_id}
          initial={{ opacity: 0, x: -16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.4, delay: i * 0.15 }}
          className="flex flex-col gap-1.5"
        >
          <p className="text-xs text-muted-foreground line-clamp-1">
            {p.question_prompt}
          </p>
          <div className="relative h-2 rounded-full bg-muted/40 overflow-hidden">
            <motion.div
              className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-foreground/70 to-foreground"
              initial={{ width: 0 }}
              animate={{ width: `${p.percentile}%` }}
              transition={{ duration: 0.9, delay: i * 0.15 + 0.2, ease: "easeOut" }}
            />
          </div>
          <p className="text-xs tabular-nums text-muted-foreground/70">
            You scored higher than {p.percentile}% of respondents
          </p>
        </motion.div>
      ))}
    </div>
  );
}

// ─── Share section ─────────────────────────────────────────────────────────────

function ShareSection({
  identity,
  sessionId,
  tone,
  respondentName,
}: {
  identity: Identity;
  sessionId: string;
  tone: Form["tone"];
  respondentName: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const shareUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/share/${sessionId}`
      : `/share/${sessionId}`;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      toast.success("Share link copied");
      setTimeout(() => setCopied(false), 2200);
    } catch {
      toast.error("Couldn't copy link");
    }
  }

  async function handleSaveImage() {
    if (!cardRef.current) return;
    setSaving(true);
    try {
      const html2canvas = (await import("html2canvas-pro")).default;
      const canvas = await html2canvas(cardRef.current, {
        backgroundColor: null,
        scale: 2,
        useCORS: true,
      });
      const link = document.createElement("a");
      link.download = `pulse-${identity.label.replace(/\s+/g, "-").toLowerCase()}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
      toast.success("Saved to downloads");
    } catch (e) {
      console.error("[save image]:", e);
      toast.error("Couldn't save image");
    } finally {
      setSaving(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="flex flex-col items-center gap-4 w-full"
    >
      {/* Visual share card */}
      <div ref={cardRef}>
        <ShareCard identity={identity} tone={tone} respondentName={respondentName} />
      </div>

      {/* Action buttons */}
      <div className="flex gap-3 w-full max-w-sm">
        <Button
          variant="outline"
          onClick={handleCopy}
          className="flex-1"
          disabled={copied}
        >
          {copied ? (
            <Check className="h-4 w-4 mr-2" />
          ) : (
            <Copy className="h-4 w-4 mr-2" />
          )}
          {copied ? "Copied" : "Copy share link"}
        </Button>
        <Button
          onClick={handleSaveImage}
          className="flex-1"
          disabled={saving}
        >
          <Download className="h-4 w-4 mr-2" />
          {saving ? "Saving…" : "Save image"}
        </Button>
      </div>
    </motion.div>
  );
}

// ─── Root CompleteStage ────────────────────────────────────────────────────────

export function CompleteStage({
  form,
  sessionId,
}: {
  form: Form;
  sessionId: string | null;
}) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [percentiles, setPercentiles] = useState<Percentile[]>([]);
  const [respondentName, setRespondentName] = useState<string | null>(null);
  const fetchedRef = useRef(false);

  // Fetch identity once
  useEffect(() => {
    if (fetchedRef.current || !sessionId) return;
    fetchedRef.current = true;

    fetch("/api/complete-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = (await res.json()) as {
          identity: Identity;
          percentiles: Percentile[];
          respondent_name?: string | null;
        };
        setIdentity(data.identity);
        setPercentiles(data.percentiles ?? []);
        setRespondentName(data.respondent_name ?? null);
        setPhase("intro");
      })
      .catch((e) => {
        console.error("[complete-session]:", e);
        // Fallback identity locally so the UX never dead-ends
        setIdentity({
          label: "Quiet Observer",
          summary:
            "You took the time to share thoughtful answers — your perspective is uniquely yours.",
          highlights: [
            "Engaged with every question",
            "Brought a thoughtful voice",
            "Made it through the whole form",
          ],
        });
        setRespondentName(null);
        setPhase("intro");
      });
  }, [sessionId]);

  // Drive sequential reveal
  const advancePhase = useCallback((from: Phase) => {
    setPhase((curr) => {
      if (curr !== from) return curr;
      const order: Phase[] = [
        "loading",
        "intro",
        "label",
        "summary",
        "highlights",
        "percentiles",
        "share",
      ];
      const idx = order.indexOf(curr);
      return order[idx + 1] ?? curr;
    });
  }, []);

  useEffect(() => {
    if (phase === "loading" || phase === "share") return;
    const dur = PHASE_DURATIONS[phase];
    const t = setTimeout(() => advancePhase(phase), dur);
    return () => clearTimeout(t);
  }, [phase, advancePhase]);

  // Render
  if (phase === "loading" || !identity) {
    return (
      <div className="flex flex-col items-center justify-center px-12 py-16 w-full">
        <LoadingShimmer />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-start px-6 md:px-12 py-8 md:py-10 max-w-2xl w-full mx-auto gap-6 md:gap-8 overflow-y-auto">
      {/* Phase 1: Intro */}
      <AnimatePresence>
        {phase === "intro" && (
          <motion.p
            key="intro"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
            className="text-sm font-medium tracking-widest uppercase text-muted-foreground"
          >
            {respondentName
              ? `Here's what we heard, ${respondentName}…`
              : "Here's what we heard…"}
          </motion.p>
        )}
      </AnimatePresence>

      {/* Phase 2+: Label persists once revealed */}
      <AnimatePresence>
        {(phase === "label" ||
          phase === "summary" ||
          phase === "highlights" ||
          phase === "percentiles" ||
          phase === "share") && (
          <motion.div
            key="label"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4 }}
            className="flex flex-col items-center gap-1.5"
          >
            <p className="text-xs font-medium tracking-widest uppercase text-muted-foreground">
              You are
            </p>
            <AnimatedLabel label={identity.label} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Phase 3+: Summary */}
      <AnimatePresence>
        {(phase === "summary" ||
          phase === "highlights" ||
          phase === "percentiles" ||
          phase === "share") && (
          <motion.div
            key="summary"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            {phase === "summary" ? (
              <TypewriterSummary text={identity.summary} />
            ) : (
              <p className="text-lg text-muted-foreground leading-relaxed text-center max-w-md">
                {identity.summary}
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Phase 4+: Highlights */}
      <AnimatePresence>
        {(phase === "highlights" ||
          phase === "percentiles" ||
          phase === "share") && (
          <motion.div
            key="highlights"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
            className="w-full flex flex-col items-center gap-3"
          >
            <p className="text-xs font-medium tracking-widest uppercase text-muted-foreground">
              Highlights
            </p>
            <HighlightCards highlights={identity.highlights} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Phase 5+: Percentiles */}
      <AnimatePresence>
        {(phase === "percentiles" || phase === "share") &&
          percentiles.length > 0 && (
            <motion.div
              key="percentiles"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3 }}
              className="w-full flex flex-col items-center gap-3"
            >
              <p className="text-xs font-medium tracking-widest uppercase text-muted-foreground">
                Where you stood
              </p>
              <PercentileBars percentiles={percentiles} />
            </motion.div>
          )}
      </AnimatePresence>

      {/* Phase 6: Share */}
      <AnimatePresence>
        {phase === "share" && sessionId && (
          <motion.div
            key="share"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4 }}
            className="w-full flex flex-col items-center gap-3 pt-2"
          >
            <ShareSection
              identity={identity}
              sessionId={sessionId}
              tone={form.tone}
              respondentName={respondentName}
            />
            <p className="text-xs text-muted-foreground/70">
              Thanks for completing &ldquo;{form.title}&rdquo;
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
