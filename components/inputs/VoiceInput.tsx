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
  disabled?: boolean;
}

const MAX_DURATION_MS = 10 * 60_000;
const TYPEWRITER_MS = 30;

// ─── Recording shader ─────────────────────────────────────────────────────────
// Shown while recording. This is a Shadertoy-style fragment shader translated
// into a local WebGL canvas and driven by the mic amplitude.

const WAVE_VERTEX_SHADER = `
attribute vec2 a_position;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const WAVE_FRAGMENT_SHADER = `
precision mediump float;

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_amp;

void main() {
  vec2 p = gl_FragCoord.xy / u_resolution.xy;
  float t = u_time * 0.001;
  float amp = 0.34 + u_amp * 1.25;

  vec2 cells = vec2(84.0, 19.0);
  vec2 grid = floor(p * cells);
  vec2 cell = fract(p * cells) - 0.5;
  vec2 pixelCell = vec2(cell.x * 2.7, cell.y * 1.45);
  float pixel = smoothstep(0.44, 0.22, max(abs(pixelCell.x), abs(pixelCell.y)));

  float x = grid.x / cells.x;
  float y = (grid.y / cells.y) * 2.0 - 1.0;

  float columnSeed = floor(x * cells.x);
  float stepped =
    pow(abs(sin(columnSeed * 0.47 + t * 1.6)), 5.0) * 0.56 +
    pow(abs(sin(columnSeed * 1.13 - t * 2.1)), 8.0) * 0.34 +
    pow(abs(sin(columnSeed * 0.21 + t * 0.7)), 4.0) * 0.16;
  float envelope =
    0.08 +
    stepped * 0.34;
  envelope *= amp;

  float rowActive = step(abs(y), envelope);
  float centerLine = step(abs(y), 0.08);
  float active = max(rowActive, centerLine * 0.42);

  vec3 greyDot = vec3(0.74, 0.77, 0.80);
  vec3 orange = vec3(1.0, 0.34, 0.0);

  float breathe = 0.84 + 0.16 * sin(t * 3.0 + columnSeed * 0.18);
  vec3 dotColor = mix(greyDot, orange, active);

  float alpha = pixel * (0.045 + active * 0.92 * breathe);
  vec3 color = dotColor;

  gl_FragColor = vec4(color, alpha);
}
`;

function createShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error("[RecordingWaveformShader] shader compile failed", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createProgram(gl: WebGLRenderingContext): WebGLProgram | null {
  const vertex = createShader(gl, gl.VERTEX_SHADER, WAVE_VERTEX_SHADER);
  const fragment = createShader(gl, gl.FRAGMENT_SHADER, WAVE_FRAGMENT_SHADER);
  if (!vertex || !fragment) return null;

  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);

  gl.deleteShader(vertex);
  gl.deleteShader(fragment);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error("[RecordingWaveformShader] program link failed", gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }

  return program;
}

function RecordingWaveformShader({
  getAmplitude,
}: {
  getAmplitude: () => number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);

  const getAmpRef = useRef(getAmplitude);
  useEffect(() => {
    getAmpRef.current = getAmplitude;
  }, [getAmplitude]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: false,
    });
    if (!gl) return;

    const program = createProgram(gl);
    if (!program) return;

    const positionLocation = gl.getAttribLocation(program, "a_position");
    const resolutionLocation = gl.getUniformLocation(program, "u_resolution");
    const timeLocation = gl.getUniformLocation(program, "u_time");
    const ampLocation = gl.getUniformLocation(program, "u_amp");

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    );

    let smoothedAmp = 0;

    function resize() {
      if (!canvas || !gl) return;
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.floor(rect.width * dpr));
      const height = Math.max(1, Math.floor(rect.height * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      gl.viewport(0, 0, width, height);
    }

    function draw(now: number) {
      resize();
      smoothedAmp += (getAmpRef.current() - smoothedAmp) * 0.16;

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.enableVertexAttribArray(positionLocation);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
      gl.uniform2f(resolutionLocation, canvas.width, canvas.height);
      gl.uniform1f(timeLocation, now);
      gl.uniform1f(ampLocation, smoothedAmp);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      rafRef.current = requestAnimationFrame(draw);
    }

    rafRef.current = requestAnimationFrame(draw);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (buffer) gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    };
  }, []);

  return (
    <div className="flex w-full flex-col items-center gap-3">
      <canvas
        ref={canvasRef}
        className="h-28 w-full max-w-md rounded-[28px] opacity-100"
      />
      <div className="flex items-center gap-2">
        <p className="text-sm text-muted-foreground">Listening</p>
        <motion.span
          className="h-2 w-2 rounded-full bg-[#ff4d00]"
          animate={{ opacity: [0.3, 1, 0.3], scale: [0.9, 1.25, 0.9] }}
          transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
        />
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

function ModeToggleButton({
  mode,
  disabled,
  onClick,
}: {
  mode: "type" | "voice";
  disabled?: boolean;
  onClick: () => void;
}) {
  const Icon = mode === "type" ? Keyboard : Mic;
  const label = mode === "type" ? "TYPE" : "VOICE";

  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      whileHover={disabled ? {} : { scale: 1.04, y: -1 }}
      whileTap={disabled ? {} : { scale: 0.96 }}
      transition={{ type: "spring", stiffness: 360, damping: 24 }}
      className="group flex items-center gap-2 rounded-full border border-foreground/10 bg-foreground/[0.04] px-3.5 py-2 text-foreground/55 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] backdrop-blur transition-colors hover:bg-foreground/[0.07] hover:text-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-35"
      aria-label={mode === "type" ? "Switch to typing" : "Switch to voice"}
    >
      <Icon className="h-4 w-4" />
      <span className="font-mono text-[11px] font-medium tracking-[0.18em]">
        {label}
      </span>
    </motion.button>
  );
}

// ─── VoiceInput ───────────────────────────────────────────────────────────────

export function VoiceInput({ question, onSubmit, disabled = false }: VoiceInputProps) {
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [transcript, setTranscript] = useState("");
  const [fallbackTextStarted, setFallbackTextStarted] = useState(false);

  const capture = useAudioCapture();

  // Timers
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    if (disabled) return;
    try {
      await capture.start();
      setVoiceState("recording");

      // Safety auto-stop after 10 minutes — users normally tap to finish.
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
    if (disabled && voiceState === "idle") return;
    if (autoStopRef.current) clearTimeout(autoStopRef.current);

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
    if (disabled) return;
    void stopAndProcess();
  }

  function handleSubmit() {
    if (disabled) return;
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
    if (disabled) return;
    setFallbackTextStarted(false);
    setVoiceState("typing");
  }

  function handleSwitchToVoice() {
    setFallbackTextStarted(false);
    setVoiceState("idle");
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex min-h-[260px] w-full flex-col">
      <div
        className={`flex flex-1 flex-col items-center justify-center gap-6 px-6 ${
          voiceState === "typing" || voiceState === "confirming" || voiceState === "error"
            ? "py-6"
            : "py-16"
        }`}
      >
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
              disabled={disabled}
              whileHover={disabled ? {} : { scale: 1.06 }}
              whileTap={disabled ? {} : { scale: 0.94 }}
              transition={{ type: "spring", stiffness: 360, damping: 24 }}
              className="relative flex h-28 w-28 items-center justify-center rounded-full border-2 border-border bg-card shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed"
            >
              {/* Idle breathing ring */}
              <motion.span
                className="absolute inset-0 rounded-full border border-foreground/10"
                animate={{ scale: [1, 1.18, 1], opacity: [0.6, 0, 0.6] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: "easeOut" }}
              />
              <Mic className="h-8 w-8 text-foreground/70" />
            </motion.button>

            <p className="text-sm text-muted-foreground">
              {disabled ? "Listen first" : "Tap to speak"}
            </p>

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
            className="flex w-full flex-col items-center gap-5"
          >
            {/* Waveform shader runs only while recording */}
            <RecordingWaveformShader getAmplitude={capture.getAmplitude} />

            <motion.button
              onClick={handleTapStop}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.96 }}
              className="group relative isolate -mt-3 flex h-16 min-w-48 items-center justify-center overflow-hidden rounded-[999px] bg-[#111820] text-white shadow-none transition-transform hover:scale-[1.03] hover:bg-[#0b1118] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_24%_12%,rgba(255,255,255,0.16),transparent_30%),linear-gradient(135deg,rgba(255,255,255,0.08),transparent_45%)]" />
              <span className="pointer-events-none absolute -left-20 top-0 h-full w-20 -skew-x-12 bg-white/30 blur-lg transition-transform duration-700 group-hover:translate-x-72" />
              <Mic className="relative z-10 h-5 w-5" />
            </motion.button>

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
            className="relative flex w-full flex-col gap-4 pb-14"
          >
            <p className="text-sm text-muted-foreground/70">
              Here&apos;s what I heard — fix anything before confirming.
            </p>

            <div className="relative">
              <textarea
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                rows={4}
                autoFocus
                className="font-matter scrollbar-thin scrollbar-thumb-foreground/20 scrollbar-track-transparent min-h-[180px] w-full resize-none bg-transparent px-2 py-2 text-[1.6rem] font-medium leading-relaxed text-transparent caret-transparent outline-none md:text-[2rem]"
              />
              <div className="pointer-events-none absolute inset-0 overflow-hidden px-2 py-2">
                <div className="font-matter whitespace-pre-wrap break-words text-[1.6rem] font-medium leading-relaxed text-foreground md:text-[2rem]">
                  {transcript}
                  <motion.span
                    className="ml-1 inline-block h-[1.6rem] w-[5px] translate-y-1 rounded-full bg-[#ff4d00] md:h-[2rem] md:w-[6px]"
                    animate={{ opacity: [0, 1, 1, 0] }}
                    transition={{ duration: 1.05, repeat: Infinity, times: [0, 0.2, 0.72, 1] }}
                  />
                </div>
              </div>
            </div>

            <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between">
              <button
                onClick={handleRetry}
                className="text-sm text-muted-foreground/70 transition-colors hover:text-foreground"
              >
                Try again
              </button>
              <Button
                variant="ghost"
                onClick={handleSubmit}
                disabled={disabled || !transcript.trim()}
                className="group relative isolate h-10 overflow-hidden rounded-full bg-[#111820] px-5 text-sm font-medium text-white shadow-none transition-transform hover:scale-[1.03] hover:bg-[#0b1118] hover:text-white disabled:opacity-45"
              >
                <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_24%_12%,rgba(255,255,255,0.16),transparent_30%),linear-gradient(135deg,rgba(255,255,255,0.08),transparent_45%)]" />
                <span className="pointer-events-none absolute -left-12 top-0 h-full w-12 -skew-x-12 bg-white/30 blur-lg transition-transform duration-700 group-hover:translate-x-48" />
                <span className="relative z-10">Looks right →</span>
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
            <TextInput
              question={question}
              disabled={disabled}
              onTextChange={(value) => setFallbackTextStarted(value.trim().length > 0)}
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
              disabled={disabled}
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

        </AnimatePresence>
      </div>
      <div className="grid grid-cols-[1fr_auto] items-center gap-4 pt-6">
        <div>
          <AnimatePresence>
            {voiceState === "error" && !fallbackTextStarted && (
              <motion.p
                className="text-sm text-[#b66100]"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
              >
                I didn&apos;t catch that — try typing instead.
              </motion.p>
            )}
          </AnimatePresence>
        </div>
        <div className="flex justify-end">
          <AnimatePresence>
            {voiceState === "idle" && (
              <ModeToggleButton
                key="switch-to-type"
                mode="type"
                disabled={disabled}
                onClick={handleSwitchToText}
              />
            )}
            {voiceState === "typing" && (
              <ModeToggleButton
                key="switch-to-voice"
                mode="voice"
                disabled={disabled}
                onClick={handleSwitchToVoice}
              />
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
