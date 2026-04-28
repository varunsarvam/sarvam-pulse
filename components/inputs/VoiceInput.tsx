"use client";

import { useRef, useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Mic } from "lucide-react";
import type { Question } from "@/lib/types";

// ─── Types ────────────────────────────────────────────────────────────────────

type VoiceState = "idle" | "recording" | "processing" | "review";

interface VoiceInputProps {
  question: Question;
  onSubmit: (value: { type: "voice"; value: string; audioBlob: Blob }) => void;
}

const MAX_DURATION_MS = 30_000;
const BAR_COUNT = 28;

// ─── Component ────────────────────────────────────────────────────────────────

export function VoiceInput({ question, onSubmit }: VoiceInputProps) {
  const [state, setState] = useState<VoiceState>("idle");
  const [transcript, setTranscript] = useState("");
  const [elapsed, setElapsed] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  void question;

  useEffect(() => () => teardown(), []);

  function teardown() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (autoStopRef.current) clearTimeout(autoStopRef.current);
    if (tickRef.current) clearInterval(tickRef.current);
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    audioCtxRef.current?.close().catch(() => {});
  }

  // ── Canvas waveform ────────────────────────────────────────────────────────

  function drawWaveform() {
    const analyser = analyserRef.current;
    const canvas = canvasRef.current;
    if (!analyser || !canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);

    const { width: W, height: H } = canvas;
    ctx.clearRect(0, 0, W, H);

    const step = Math.floor(data.length / BAR_COUNT);
    const barW = W / BAR_COUNT;
    const gap = barW * 0.35;

    for (let i = 0; i < BAR_COUNT; i++) {
      const amp = data[i * step] / 255;
      const barH = Math.max(4, amp * H * 0.85);
      const x = i * barW + gap / 2;
      const y = (H - barH) / 2;

      ctx.fillStyle = `rgba(239,68,68,${0.5 + amp * 0.5})`;
      ctx.beginPath();
      // roundRect may not exist in all environments
      if (ctx.roundRect) {
        ctx.roundRect(x, y, barW - gap, barH, 2);
      } else {
        ctx.rect(x, y, barW - gap, barH);
      }
      ctx.fill();
    }

    rafRef.current = requestAnimationFrame(drawWaveform);
  }

  // ── Recording ──────────────────────────────────────────────────────────────

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";

      const recorder = new MediaRecorder(stream, { mimeType });
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = handleStop;
      recorder.start();

      setState("recording");
      setElapsed(0);
      drawWaveform();

      tickRef.current = setInterval(
        () => setElapsed((s) => s + 1),
        1000
      );

      autoStopRef.current = setTimeout(() => {
        if (recorderRef.current?.state === "recording") {
          recorderRef.current.stop();
        }
      }, MAX_DURATION_MS);
    } catch (err) {
      console.error("Mic error:", err);
    }
  }

  function stopRecording() {
    if (autoStopRef.current) clearTimeout(autoStopRef.current);
    if (tickRef.current) clearInterval(tickRef.current);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());

    // Clear canvas
    const canvas = canvasRef.current;
    if (canvas) canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);

    recorderRef.current?.stop();
  }

  async function handleStop() {
    setState("processing");
    audioCtxRef.current?.close().catch(() => {});

    const blob = new Blob(chunksRef.current, { type: "audio/webm" });

    try {
      const form = new FormData();
      form.append("file", blob, "recording.webm");
      const res = await fetch("/api/transcribe", { method: "POST", body: form });
      const data = res.ok ? await res.json() : {};
      setTranscript(data.transcript ?? "Voice transcript would appear here");
    } catch {
      setTranscript("Voice transcript would appear here");
    }

    setState("review");
  }

  function handleTap() {
    if (state === "idle") startRecording();
    else if (state === "recording") stopRecording();
  }

  function submit() {
    const blob = new Blob(chunksRef.current, { type: "audio/webm" });
    onSubmit({ type: "voice", value: transcript.trim(), audioBlob: blob });
  }

  function retry() {
    setTranscript("");
    setElapsed(0);
    setState("idle");
  }

  const remaining = Math.max(0, 30 - elapsed);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col items-center gap-6 w-full py-2">
      <AnimatePresence mode="wait">

        {/* ── Idle ── */}
        {state === "idle" && (
          <motion.div
            key="idle"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85 }}
            transition={{ duration: 0.25 }}
            className="flex flex-col items-center gap-4"
          >
            <motion.button
              onClick={handleTap}
              whileHover={{ scale: 1.06 }}
              whileTap={{ scale: 0.94 }}
              transition={{ type: "spring", stiffness: 360, damping: 24 }}
              className="relative flex h-28 w-28 items-center justify-center rounded-full border-2 border-border bg-card shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {/* Soft pulse ring */}
              <motion.span
                className="absolute inset-0 rounded-full border border-foreground/10"
                animate={{ scale: [1, 1.18, 1], opacity: [0.6, 0, 0.6] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: "easeOut" }}
              />
              <Mic className="h-8 w-8 text-foreground/70" />
            </motion.button>
            <p className="text-sm text-muted-foreground">Tap to speak</p>
          </motion.div>
        )}

        {/* ── Recording ── */}
        {state === "recording" && (
          <motion.div
            key="recording"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85 }}
            transition={{ duration: 0.25 }}
            className="flex flex-col items-center gap-4 w-full"
          >
            <button
              onClick={handleTap}
              className="relative flex h-28 w-28 flex-col items-center justify-center rounded-full border-2 border-red-500/60 bg-card shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
            >
              {/* Waveform canvas */}
              <canvas
                ref={canvasRef}
                width={80}
                height={40}
                className="rounded"
              />
              {/* Red pulse dot */}
              <motion.span
                className="absolute top-3 right-3 h-2.5 w-2.5 rounded-full bg-red-500"
                animate={{ opacity: [1, 0.2, 1] }}
                transition={{ duration: 1.1, repeat: Infinity }}
              />
            </button>

            <div className="flex flex-col items-center gap-1">
              <p className="text-sm text-muted-foreground">Tap when you&apos;re done</p>
              <p className="text-xs tabular-nums text-muted-foreground/50">
                {remaining}s remaining
              </p>
            </div>
          </motion.div>
        )}

        {/* ── Processing ── */}
        {state === "processing" && (
          <motion.div
            key="processing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="flex flex-col items-center gap-4"
          >
            <div className="flex h-28 w-28 items-center justify-center rounded-full border-2 border-border bg-card">
              <motion.div
                className="h-8 w-8 rounded-full border-2 border-muted-foreground/30 border-t-foreground"
                animate={{ rotate: 360 }}
                transition={{ duration: 0.9, repeat: Infinity, ease: "linear" }}
              />
            </div>
            <p className="text-sm text-muted-foreground">Listening to you…</p>
          </motion.div>
        )}

        {/* ── Review ── */}
        {state === "review" && (
          <motion.div
            key="review"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3 }}
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
                onClick={retry}
                className="text-xs text-muted-foreground underline-offset-2 hover:underline"
              >
                Try again
              </button>
              <Button onClick={submit} disabled={!transcript.trim()}>
                Looks right →
              </Button>
            </div>
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  );
}
