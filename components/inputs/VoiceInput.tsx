"use client";

import { useRef, useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Mic, Keyboard } from "lucide-react";
import { useAudioCapture } from "@/hooks/useAudioCapture";
import { TextInput } from "./TextInput";
import type { Question } from "@/lib/types";

// ─── Constants ────────────────────────────────────────────────────────────────

type VoiceState = "idle" | "recording" | "transcribing" | "confirming" | "error" | "typing";

interface VoiceInputProps {
  question: Question;
  onSubmit: (value: { type: "voice"; value: string; audioBlob: Blob }) => void;
}

const MAX_DURATION_MS = 30_000;
const BAR_COUNT = 28;
const TYPEWRITER_MS = 30;

// ─── ListeningBlock ───────────────────────────────────────────────────────────
// Shown while recording. Canvas waveform + animated dots respond to amplitude.
// getAmplitude is passed as a ref-backed stable function from useAudioCapture.

function ListeningBlock({
  getAmplitude,
}: {
  getAmplitude: () => number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const [dotAmps, setDotAmps] = useState([0.2, 0.3, 0.15]);

  // Keep a stable ref to getAmplitude so setInterval/rAF closures always read fresh
  const getAmpRef = useRef(getAmplitude);
  useEffect(() => {
    getAmpRef.current = getAmplitude;
  }, [getAmplitude]);

  // Canvas waveform at 60 fps — no React state updates, pure canvas
  useEffect(() => {
    function draw() {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const amp = getAmpRef.current();
      const { width: W, height: H } = canvas;
      ctx.clearRect(0, 0, W, H);

      const barW = W / BAR_COUNT;
      const gap = barW * 0.35;

      for (let i = 0; i < BAR_COUNT; i++) {
        // Per-bar noise: sine ripple that shifts over time — looks organic
        const noise = Math.sin(Date.now() * 0.003 + i * 0.75) * 0.35 + 0.65;
        const barAmp = amp * noise;
        const barH = Math.max(3, barAmp * H * 0.85);
        const x = i * barW + gap / 2;
        const y = (H - barH) / 2;

        ctx.fillStyle = `rgba(239,68,68,${0.3 + barAmp * 0.55})`;
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(x, y, barW - gap, barH, 2);
        } else {
          ctx.rect(x, y, barW - gap, barH);
        }
        ctx.fill();
      }

      rafRef.current = requestAnimationFrame(draw);
    }

    rafRef.current = requestAnimationFrame(draw);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Dot amplitudes updated at ~12 fps — each dot gets slight variation
  useEffect(() => {
    const id = setInterval(() => {
      const amp = getAmpRef.current();
      setDotAmps([
        amp * (0.65 + Math.random() * 0.35),
        amp * (0.80 + Math.random() * 0.20),
        amp * (0.55 + Math.random() * 0.45),
      ]);
    }, 80);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex flex-col items-center gap-3">
      <canvas
        ref={canvasRef}
        width={200}
        height={36}
        className="rounded opacity-75"
      />
      <div className="flex items-center gap-2">
        <p className="text-sm text-muted-foreground">Listening</p>
        {/* Dots scale/opacity track per-dot amplitude */}
        <div className="flex items-end gap-1" style={{ height: 20 }}>
          {dotAmps.map((amp, i) => (
            <motion.span
              key={i}
              className="inline-block w-[5px] rounded-full bg-red-400"
              animate={{
                height: `${Math.round(6 + amp * 14)}px`,
                opacity: 0.45 + amp * 0.55,
              }}
              transition={{ duration: 0.1, ease: "easeOut" }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── TranscribingBlock ────────────────────────────────────────────────────────
// Frozen placeholder with shimmer — shown while STT request is in flight.

function TranscribingBlock() {
  return (
    <div className="flex flex-col items-center gap-3">
      {/* Frozen waveform placeholder with sliding shimmer */}
      <div className="relative w-[200px] h-9 rounded bg-muted/40 overflow-hidden">
        <motion.div
          className="absolute inset-0 bg-gradient-to-r from-transparent via-white/25 to-transparent"
          animate={{ x: ["-100%", "100%"] }}
          transition={{ duration: 1.1, repeat: Infinity, ease: "linear" }}
        />
      </div>
      <div className="flex items-center gap-1.5">
        <p className="text-sm text-muted-foreground">Transcribing</p>
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="inline-block w-1 h-1 rounded-full bg-muted-foreground/50"
            animate={{ opacity: [0.25, 1, 0.25], scale: [0.8, 1.1, 0.8] }}
            transition={{ duration: 1.3, repeat: Infinity, delay: i * 0.22 }}
          />
        ))}
      </div>
    </div>
  );
}

// ─── VoiceInput ───────────────────────────────────────────────────────────────

export function VoiceInput({ question, onSubmit }: VoiceInputProps) {
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [transcript, setTranscript] = useState("");
  const [elapsed, setElapsed] = useState(0);

  const capture = useAudioCapture();

  // Timers
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const transcriptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Store the final WAV blob so it can be passed through to onSubmit
  const audioBlobRef = useRef<Blob | null>(null);

  // Typewriter internals for CONFIRMING state
  const charQueueRef = useRef<string[]>([]);
  const displayedRef = useRef<string>("");
  const typingActiveRef = useRef(false);

  // Stable ref to capture.stop — prevents stale closure in autoStopRef
  const stopRef = useRef(capture.stop);
  useEffect(() => {
    stopRef.current = capture.stop;
  }, [capture.stop]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (autoStopRef.current) clearTimeout(autoStopRef.current);
      if (tickRef.current) clearInterval(tickRef.current);
      if (transcriptTimerRef.current) clearTimeout(transcriptTimerRef.current);
    };
  }, []);

  // ── Typewriter ──────────────────────────────────────────────────────────────

  function startTypewriter(fullText: string) {
    charQueueRef.current = [...fullText];
    displayedRef.current = "";
    typingActiveRef.current = true;

    function tick() {
      const ch = charQueueRef.current.shift();
      if (ch !== undefined) {
        displayedRef.current += ch;
        setTranscript(displayedRef.current);
        transcriptTimerRef.current = setTimeout(tick, TYPEWRITER_MS);
      } else {
        typingActiveRef.current = false;
      }
    }

    transcriptTimerRef.current = setTimeout(tick, TYPEWRITER_MS);
  }

  // ── Recording lifecycle ─────────────────────────────────────────────────────

  async function handleTapStart() {
    try {
      await capture.start();
      setVoiceState("recording");
      setElapsed(0);

      tickRef.current = setInterval(
        () => setElapsed((s) => s + 1),
        1000
      );

      // Auto-stop after 30s — uses ref so it always calls the latest stop()
      autoStopRef.current = setTimeout(
        () => void stopAndProcess(),
        MAX_DURATION_MS
      );
    } catch (err) {
      console.error("[VoiceInput] mic error:", err);
      setVoiceState("error");
    }
  }

  async function stopAndProcess() {
    if (autoStopRef.current) clearTimeout(autoStopRef.current);
    if (tickRef.current) clearInterval(tickRef.current);

    setVoiceState("transcribing");

    try {
      const { blob, transcript: streamingText } = await stopRef.current();
      audioBlobRef.current = blob;

      // Primary path: use streaming STT transcript if available
      if (streamingText?.trim()) {
        setVoiceState("confirming");
        startTypewriter(streamingText.trim());
        return;
      }

      // Fallback: batch STT via /api/transcribe with the WAV blob
      const form = new FormData();
      form.append("file", blob, "recording.wav");

      const res = await fetch("/api/transcribe", { method: "POST", body: form });
      if (!res.ok) throw new Error(`STT ${res.status}`);

      const { transcript: batchText } = (await res.json()) as {
        transcript?: string;
      };

      if (!batchText?.trim()) throw new Error("empty transcript");

      setVoiceState("confirming");
      startTypewriter(batchText.trim());
    } catch (err) {
      console.error("[VoiceInput] STT error:", err);
      setVoiceState("error");
    }
  }

  function handleTapStop() {
    void stopAndProcess();
  }

  function handleSubmit() {
    onSubmit({
      type: "voice",
      value: transcript.trim(),
      audioBlob: audioBlobRef.current ?? new Blob([], { type: "audio/wav" }),
    });
  }

  function handleRetry() {
    setTranscript("");
    setElapsed(0);
    charQueueRef.current = [];
    displayedRef.current = "";
    typingActiveRef.current = false;
    if (transcriptTimerRef.current) clearTimeout(transcriptTimerRef.current);
    audioBlobRef.current = null;
    setVoiceState("idle");
  }

  function handleSwitchToText() {
    setVoiceState("typing");
  }

  function handleSwitchToVoice() {
    setVoiceState("idle");
  }

  const remaining = Math.max(0, 30 - elapsed);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col items-center gap-6 w-full py-2">
      <AnimatePresence mode="wait">

        {/* ── IDLE ── */}
        {voiceState === "idle" && (
          <motion.div
            key="idle"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85 }}
            transition={{ duration: 0.25 }}
            className="flex flex-col items-center gap-4"
          >
            <motion.button
              onClick={handleTapStart}
              whileHover={{ scale: 1.06 }}
              whileTap={{ scale: 0.94 }}
              transition={{ type: "spring", stiffness: 360, damping: 24 }}
              className="relative flex h-28 w-28 items-center justify-center rounded-full border-2 border-border bg-card shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {/* Idle breathing ring */}
              <motion.span
                className="absolute inset-0 rounded-full border border-foreground/10"
                animate={{ scale: [1, 1.18, 1], opacity: [0.6, 0, 0.6] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: "easeOut" }}
              />
              <Mic className="h-8 w-8 text-foreground/70" />
            </motion.button>

            <p className="text-sm text-muted-foreground">Tap to speak</p>

            {/* Secondary affordance — intentionally quiet */}
            <motion.button
              onClick={handleSwitchToText}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5, duration: 0.3 }}
              className="flex items-center gap-1.5 text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors duration-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded px-1"
            >
              <Keyboard className="h-3 w-3" />
              type instead
            </motion.button>
          </motion.div>
        )}

        {/* ── RECORDING ── */}
        {voiceState === "recording" && (
          <motion.div
            key="recording"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.95 }}
            transition={{ duration: 0.25 }}
            className="flex flex-col items-center gap-5 w-full"
          >
            {/* Active mic button */}
            <motion.button
              onClick={handleTapStop}
              whileTap={{ scale: 0.94 }}
              className="relative flex h-28 w-28 items-center justify-center rounded-full border-2 border-red-500/60 bg-card shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
            >
              {/* Breathing ring */}
              <motion.span
                className="absolute inset-0 rounded-full bg-red-500/10"
                animate={{ scale: [1, 1.2, 1], opacity: [0.25, 0.65, 0.25] }}
                transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
              />
              {/* Red record dot */}
              <motion.span
                className="absolute top-3 right-3 h-2.5 w-2.5 rounded-full bg-red-500"
                animate={{ opacity: [1, 0.2, 1] }}
                transition={{ duration: 1.1, repeat: Infinity }}
              />
              <Mic className="h-8 w-8 text-red-500/70" />
            </motion.button>

            {/* Waveform always visible */}
            <ListeningBlock getAmplitude={capture.getAmplitude} />

            {/* Live transcript — fades in as words arrive from streaming STT */}
            <AnimatePresence>
              {capture.liveTranscript && (
                <motion.p
                  key="live-transcript"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  className="text-sm text-foreground/80 leading-relaxed text-center max-w-[260px]"
                >
                  {capture.liveTranscript}
                </motion.p>
              )}
            </AnimatePresence>

            <p className="text-xs tabular-nums text-muted-foreground/50">
              {remaining}s remaining — tap when you&apos;re done
            </p>
          </motion.div>
        )}

        {/* ── TRANSCRIBING ── */}
        {voiceState === "transcribing" && (
          <motion.div
            key="transcribing"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.3 }}
            className="flex flex-col items-center gap-5 w-full"
          >
            {/* Spinner orb */}
            <div className="flex h-28 w-28 items-center justify-center rounded-full border-2 border-border/50 bg-card">
              <motion.div
                className="h-8 w-8 rounded-full border-2 border-muted-foreground/30 border-t-foreground"
                animate={{ rotate: 360 }}
                transition={{ duration: 0.85, repeat: Infinity, ease: "linear" }}
              />
            </div>
            <TranscribingBlock />
          </motion.div>
        )}

        {/* ── CONFIRMING ── */}
        {voiceState === "confirming" && (
          <motion.div
            key="confirming"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.35 }}
            className="flex flex-col gap-4 w-full"
          >
            <p className="text-xs text-muted-foreground">
              Here&apos;s what I heard — fix anything before confirming.
            </p>

            <div className="relative rounded-2xl border border-border bg-muted/30 focus-within:border-foreground/30 transition-colors duration-200">
              <textarea
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                rows={4}
                autoFocus
                className="w-full resize-none rounded-2xl bg-transparent px-5 py-4 text-base leading-relaxed text-foreground focus:outline-none"
              />
            </div>

            <div className="flex items-center justify-between">
              <button
                onClick={handleRetry}
                className="text-xs text-muted-foreground underline-offset-2 hover:underline"
              >
                Try again
              </button>
              <Button onClick={handleSubmit} disabled={!transcript.trim()}>
                Looks right →
              </Button>
            </div>
          </motion.div>
        )}

        {/* ── ERROR ── */}
        {voiceState === "error" && (
          <motion.div
            key="error"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="flex flex-col gap-4 w-full"
          >
            <p className="text-sm text-amber-600 dark:text-amber-400">
              I didn&apos;t catch that — try typing instead.
            </p>
            <TextInput
              question={question}
              onSubmit={(v) =>
                onSubmit({
                  type: "voice",
                  value: v.value,
                  audioBlob: new Blob([], { type: "audio/wav" }),
                })
              }
            />
          </motion.div>
        )}

        {/* ── TYPING ── */}
        {voiceState === "typing" && (
          <motion.div
            key="typing"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.28, ease: "easeOut" }}
            className="flex flex-col gap-3 w-full"
          >
            <TextInput
              question={question}
              onSubmit={(v) =>
                onSubmit({
                  type: "voice",
                  value: v.value,
                  audioBlob: new Blob([], { type: "audio/wav" }),
                })
              }
            />
            {/* Escape hatch back to voice */}
            <motion.button
              onClick={handleSwitchToVoice}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.35, duration: 0.25 }}
              className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground/45 hover:text-muted-foreground transition-colors duration-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded px-1 py-0.5 self-center"
            >
              <Mic className="h-3 w-3" />
              use voice instead
            </motion.button>
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  );
}
