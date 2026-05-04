"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import { StaticRadialGradient } from "@paper-design/shaders-react";
import { Share2, Check } from "lucide-react";
import type { Form } from "@/lib/types";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Identity {
  label: string;
  summary: string;
  highlights: string[];
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const CARD_W = 300;
const CARD_H = 380;

// ─── Color palettes (round-robin per session) ─────────────────────────────────

export interface CardPalette {
  colorBack: string;
  colors: [string, string, string];
}

const PALETTES: CardPalette[] = [
  { colorBack: "#2e1f27", colors: ["#d92638", "#3f89c6", "#f59d38"] }, // original
  { colorBack: "#0a1a2e", colors: ["#0ea5e9", "#22d3ee", "#38bdf8"] }, // ocean
  { colorBack: "#0a1f12", colors: ["#16a34a", "#84cc16", "#ca8a04"] }, // forest
  { colorBack: "#150d2a", colors: ["#8b5cf6", "#ec4899", "#a78bfa"] }, // aurora
  { colorBack: "#1c0a06", colors: ["#ef4444", "#f97316", "#fbbf24"] }, // fire
  { colorBack: "#070f1e", colors: ["#06b6d4", "#3b82f6", "#818cf8"] }, // midnight
  { colorBack: "#1f0a14", colors: ["#f43f5e", "#fb7185", "#fda4af"] }, // rose
];

/**
 * Picks a palette deterministically from a session ID so the same respondent
 * always sees the same card, but each new session cycles through all 7 colors.
 */
export function getCardPalette(sessionId: string | null): CardPalette {
  if (!sessionId) return PALETTES[0];
  const hash = sessionId
    .replace(/-/g, "")
    .split("")
    .reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return PALETTES[hash % PALETTES.length];
}

// ─── Loading shimmer ──────────────────────────────────────────────────────────

function LoadingShimmer({ palette }: { palette: CardPalette }) {
  return (
    <div className="flex flex-col items-center gap-5">
      <div
        className="relative overflow-hidden rounded-[28px]"
        style={{ width: CARD_W, height: CARD_H }}
      >
        <StaticRadialGradient
          width={CARD_W}
          height={CARD_H}
          scale={0.45}
          offsetY={-0.16}
          colors={palette.colors}
          colorBack={palette.colorBack}
          radius={1}
          focalDistance={0}
          focalAngle={0}
          falloff={0.9}
          mixing={0.47}
          distortion={0}
          distortionShift={0}
          distortionFreq={12}
          grainMixer={1}
          grainOverlay={0.5}
        />
        <motion.div
          className="absolute inset-0 bg-gradient-to-r from-transparent via-white/6 to-transparent"
          animate={{ x: ["-100%", "100%"] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "linear" }}
        />
      </div>
      <div className="flex gap-1.5">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="h-1.5 w-1.5 rounded-full bg-white/30"
            animate={{ opacity: [0.3, 1, 0.3], y: [0, -3, 0] }}
            transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.2 }}
          />
        ))}
      </div>
    </div>
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
  const palette = getCardPalette(sessionId);

  const [identity, setIdentity] = useState<Identity | null>(null);
  const [identityError, setIdentityError] = useState<string | null>(null);
  const [retryAttempts, setRetryAttempts] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [respondentName, setRespondentName] = useState<string | null>(null);
  const [shared, setShared] = useState(false);

  // Shader focal state — updated by RAF lerp so React re-renders stay at ≤60fps
  const [focalAngle, setFocalAngle] = useState(0);
  const [focalDistance, setFocalDistance] = useState(0);

  // 3D tilt via direct DOM (zero React overhead)
  const tiltRef = useRef<HTMLDivElement>(null);
  const shineRef = useRef<HTMLDivElement>(null);

  const rafRef = useRef<number>(0);
  const cur = useRef({ rx: 0, ry: 0, angle: 0, dist: 0 });
  const tgt = useRef({ rx: 0, ry: 0, angle: 0, dist: 0 });
  const fetchedRef = useRef(false);

  // ── Fetch identity ─────────────────────────────────────────────────────────
  // Phase 5 architectural decision: NO fallback identity. On error we surface
  // a real error state with a retry button. Same endpoint, same call — this is
  // safe because /api/complete-session is idempotent (the sessions row gets
  // overwritten with the new identity_label/summary on success).

  async function fetchIdentity(isRetry: boolean) {
    if (!sessionId) return;
    if (isRetry) {
      setRetrying(true);
      setIdentityError(null);
    }
    // 12s hard cap. Server worst case is ~6s (1 attempt × 6s timeout) plus
    // ~1-2s for DB roundtrips and the heuristic fallback, so 12s gives plenty
    // of buffer. The server now ALWAYS returns an identity (LLM or heuristic
    // fallback) — this client timeout only fires on actual network/server
    // failure, in which case we surface a "tap to retry" message.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12_000);
    try {
      const res = await fetch("/api/complete-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
          message?: string;
        } | null;
        throw new Error(
          body?.message ?? body?.error ?? `status ${res.status}`
        );
      }
      const data = (await res.json()) as {
        identity: Identity;
        respondent_name?: string | null;
      };
      setIdentity(data.identity);
      setRespondentName(data.respondent_name ?? null);
      setIdentityError(null);
    } catch (e) {
      const aborted = e instanceof DOMException && e.name === "AbortError";
      console.error("[complete-session]:", e);
      const msg = aborted
        ? "Taking too long — tap to retry"
        : e instanceof Error
          ? e.message
          : "Identity unavailable";
      setIdentityError(msg);
      if (isRetry) setRetryAttempts((n) => n + 1);
    } finally {
      clearTimeout(timeoutId);
      if (isRetry) setRetrying(false);
    }
  }

  useEffect(() => {
    if (fetchedRef.current || !sessionId) return;
    fetchedRef.current = true;
    void fetchIdentity(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // ── 3D tilt + shader focal tracking ───────────────────────────────────────

  const setFocal = useCallback(
    (angle: number, dist: number) => {
      setFocalAngle(angle);
      setFocalDistance(dist);
    },
    []
  );

  useEffect(() => {
    function lerp(a: number, b: number, t: number) {
      return a + (b - a) * t;
    }
    // Lerp angles through the shortest arc
    function lerpAngle(a: number, b: number, t: number) {
      const diff = ((b - a + 540) % 360) - 180;
      return (a + diff * t + 360) % 360;
    }

    function loop() {
      const EASE_TILT = 0.08;
      const EASE_FOCAL = 0.05;
      const c = cur.current;
      const tg = tgt.current;

      c.rx = lerp(c.rx, tg.rx, EASE_TILT);
      c.ry = lerp(c.ry, tg.ry, EASE_TILT);
      c.dist = lerp(c.dist, tg.dist, EASE_FOCAL);
      c.angle = lerpAngle(c.angle, tg.angle, EASE_FOCAL);

      // 3D tilt — direct DOM, no React
      if (tiltRef.current) {
        tiltRef.current.style.transform = `perspective(1100px) rotateX(${c.rx}deg) rotateY(${c.ry}deg) scale3d(1.03,1.03,1.03)`;
      }
      // Specular highlight moves opposite to tilt (fixed light source illusion)
      if (shineRef.current) {
        const sx = 48 - c.ry * 2.5;
        const sy = 22 - c.rx * 2.2;
        shineRef.current.style.background = `radial-gradient(ellipse 115% 65% at ${sx}% ${sy}%, rgba(255,255,255,0.11), transparent 55%)`;
      }

      // Shader focal — goes through React state but RAF-throttled
      setFocal(c.angle, c.dist);

      rafRef.current = requestAnimationFrame(loop);
    }

    function onMouseMove(e: MouseEvent) {
      const el = tiltRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;

      // Tilt: use a wider zone so it stays smooth when cursor leaves the card
      const dx = (e.clientX - cx) / (rect.width * 0.7);
      const dy = (e.clientY - cy) / (rect.height * 0.7);
      tgt.current.rx = Math.max(-7, Math.min(7, -dy * 7));
      tgt.current.ry = Math.max(-7, Math.min(7, dx * 7));

      // Focal angle: atan2 from card center → degrees, offset so 0° = up
      const mx = e.clientX - cx;
      const my = e.clientY - cy;
      const angle = ((Math.atan2(my, mx) * 180) / Math.PI + 90 + 360) % 360;
      const dist = Math.min(1.8, (Math.sqrt(mx * mx + my * my) / (rect.width * 0.5)) * 1.5);
      tgt.current.angle = angle;
      tgt.current.dist = dist;
    }

    function onMouseLeave() {
      tgt.current = { rx: 0, ry: 0, angle: cur.current.angle, dist: 0 };
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseleave", onMouseLeave);
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseleave", onMouseLeave);
      cancelAnimationFrame(rafRef.current);
    };
  }, [setFocal]);

  // ── Share card ─────────────────────────────────────────────────────────────

  async function handleShare() {
    if (!sessionId) return;
    const url = `${window.location.origin}/share/${sessionId}`;
    const text = identity
      ? `I'm "${identity.label}" on Sarvam Pulse. See what you are →`
      : "Check out my Pulse identity card";

    if (navigator.share) {
      try {
        await navigator.share({ title: identity?.label ?? "Pulse", text, url });
        return;
      } catch {
        // fall through
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setShared(true);
      setTimeout(() => setShared(false), 2000);
    } catch {}
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (identityError) {
    // Designed error state — dark surface that mirrors the identity card's
    // weight, with a retry button. After 2 retry attempts we drop the button:
    // if Sarvam is persistently down, hammering the endpoint isn't helpful and
    // the user has a clear next step ("come back in a bit").
    const canRetry = retryAttempts < 2;
    return (
      <div className="flex h-full w-full items-center justify-center px-6">
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="relative w-full max-w-[360px] overflow-hidden rounded-[28px] bg-[#141821] p-7 text-white"
          style={{
            boxShadow:
              "0 60px 120px rgba(0,0,0,0.32), 0 14px 40px rgba(0,0,0,0.18), inset 0 0 0 1px rgba(255,255,255,0.06)",
          }}
        >
          {/* Soft warm glow so it doesn't read as "broken" */}
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(241,90,34,0.10),transparent_70%)]" />
          <div className="relative z-10 flex flex-col gap-5">
            <div className="flex items-center gap-2">
              <div
                className="h-2.5 w-2.5 rounded-full bg-white/80"
                style={{ boxShadow: "0 0 12px rgba(255,255,255,0.45)" }}
              />
              <span className="font-matter text-xs font-medium uppercase tracking-widest text-white/70">
                Pulse
              </span>
            </div>

            <div className="flex flex-col gap-2.5">
              <h2 className="font-display text-[1.65rem] leading-tight tracking-tight text-white">
                {canRetry
                  ? "We couldn’t capture your identity this time."
                  : "Still no luck."}
              </h2>
              <p className="font-matter text-sm leading-relaxed text-white/70">
                {canRetry
                  ? "Sarvam was busy when we asked. Your answers are saved — give it another moment and try again."
                  : "Sarvam isn’t responding right now. Come back in a bit and we’ll finish this for you."}
              </p>
            </div>

            {canRetry && (
              <button
                type="button"
                onClick={() => void fetchIdentity(true)}
                disabled={retrying}
                className="font-matter group relative isolate mt-2 flex h-11 items-center justify-center self-start overflow-hidden rounded-full bg-white px-6 text-sm font-medium text-[#141821] transition-transform hover:scale-[1.03] disabled:opacity-50"
              >
                <span className="pointer-events-none absolute -left-12 top-0 h-full w-12 -skew-x-12 bg-black/10 blur-md transition-transform duration-700 group-hover:translate-x-48" />
                <span className="relative z-10">
                  {retrying ? "Trying again…" : "Try again"}
                </span>
              </button>
            )}
          </div>
        </motion.div>
      </div>
    );
  }

  if (!identity) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <LoadingShimmer palette={palette} />
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-7 px-6">

      {/* 3D tilt wrapper */}
      <div
        ref={tiltRef}
        style={{
          transformStyle: "preserve-3d",
          willChange: "transform",
        }}
      >
        {/* Card */}
        <motion.div
          className="relative overflow-hidden rounded-[28px]"
          style={{ width: CARD_W, height: CARD_H }}
          initial={{ opacity: 0, scale: 0.88, y: 32 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
        >
          {/* Real WebGL shader — focalAngle + focalDistance driven by mouse */}
          <div className="absolute inset-0">
            <StaticRadialGradient
              width={CARD_W}
              height={CARD_H}
              scale={0.45}
              offsetY={-0.16}
              colors={palette.colors}
              colorBack={palette.colorBack}
              radius={1}
              focalDistance={focalDistance}
              focalAngle={focalAngle}
              falloff={0.9}
              mixing={0.47}
              distortion={0}
              distortionShift={0}
              distortionFreq={12}
              grainMixer={1}
              grainOverlay={0.5}
            />
          </div>

          {/* Specular highlight — updated by RAF */}
          <div ref={shineRef} className="pointer-events-none absolute inset-0" />

          {/* Inner edge rim */}
          <div
            className="pointer-events-none absolute inset-0 rounded-[28px]"
            style={{
              boxShadow:
                "inset 0 0 0 1px rgba(255,255,255,0.18), inset 0 1px 0 rgba(255,255,255,0.32)",
            }}
          />

          {/* Card content */}
          <div className="relative z-10 flex h-full flex-col p-6">
            {/* Top: brand */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div
                  className="h-2.5 w-2.5 rounded-full bg-white"
                  style={{ boxShadow: "0 0 12px rgba(255,255,255,0.7)" }}
                />
                <span className="text-xs font-medium uppercase tracking-widest text-white/80">
                  Pulse
                </span>
              </div>
              <span className="text-[10px] font-medium uppercase tracking-wider text-white/45">
                {form.tone}
              </span>
            </div>

            {/* Spacer — shader circle lives here */}
            <div className="flex-1" />

            {/* Bottom: identity text */}
            <div className="flex flex-col items-center gap-2 text-center">
              <h2
                className="text-3xl font-bold leading-[1.1] tracking-tight text-white"
                style={{ fontFamily: "var(--font-display)" }}
              >
                {identity.label}
              </h2>
              <p
                className="w-full text-[11px] leading-snug text-white/70"
                style={{
                  overflow: "hidden",
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                }}
              >
                {identity.summary}
              </p>
              {respondentName && (
                <span className="mt-2 font-mono text-[10px] text-white/40">
                  {respondentName}
                </span>
              )}
            </div>
          </div>
        </motion.div>
      </div>

      {/* Share button */}
      <motion.button
        type="button"
        onClick={handleShare}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.7, ease: "easeOut" }}
        className="flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium text-white transition-all hover:brightness-110 active:scale-95"
        style={{
          background: "rgba(255,255,255,0.12)",
          backdropFilter: "blur(12px)",
          border: "1px solid rgba(255,255,255,0.2)",
        }}
      >
        {shared ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
        {shared ? "Link copied!" : "Share card"}
      </motion.button>
    </div>
  );
}
