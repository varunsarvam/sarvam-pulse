"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import { StaticRadialGradient } from "@paper-design/shaders-react";
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

const SHADER_COLORS = ["#d92638", "#3f89c6", "#f59d38"] as const;
const SHADER_BACK = "#2e1f27";

// ─── Loading shimmer ──────────────────────────────────────────────────────────

function LoadingShimmer() {
  return (
    <div className="flex flex-col items-center gap-5">
      <div
        className="relative overflow-hidden rounded-[28px]"
        style={{ width: CARD_W, height: CARD_H }}
      >
        <StaticRadialGradient
          width={CARD_W}
          height={CARD_H}
          colors={[...SHADER_COLORS]}
          colorBack={SHADER_BACK}
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
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [identityError, setIdentityError] = useState<string | null>(null);
  const [respondentName, setRespondentName] = useState<string | null>(null);

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

  useEffect(() => {
    if (fetchedRef.current || !sessionId) return;
    fetchedRef.current = true;

    fetch("/api/complete-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId }),
    })
      .then(async (res) => {
        if (!res.ok) {
          // Phase 5: NO fallback identity. If classification failed (502) or
          // anything else went wrong, surface the error so the user can retry.
          // TODO(phase-6): proper error UX with retry button.
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
      })
      .catch((e: Error) => {
        console.error("[complete-session]:", e);
        setIdentityError(e.message ?? "Identity unavailable");
      });
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

  // ── Render ─────────────────────────────────────────────────────────────────

  if (identityError) {
    // TODO(phase-6): replace with a designed error state (retry button, etc.).
    // For now, render a plain text fallback rather than loop on the shimmer.
    return (
      <div className="flex h-full w-full items-center justify-center px-8">
        <div className="max-w-md text-center text-white/80">
          <p className="text-lg font-medium">
            We couldn&apos;t generate your identity right now.
          </p>
          <p className="mt-3 text-sm text-white/55">
            Please try again in a moment.
          </p>
        </div>
      </div>
    );
  }

  if (!identity) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <LoadingShimmer />
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
          filter:
            "drop-shadow(0 60px 120px rgba(0,0,0,0.32)) drop-shadow(0 14px 40px rgba(0,0,0,0.18))",
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
              colors={[...SHADER_COLORS]}
              colorBack={SHADER_BACK}
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
          <div className="relative z-10 flex h-full flex-col justify-between p-6">
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

            {/* Middle: identity */}
            <div className="flex flex-col gap-3">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-white/60">
                {respondentName ? `${respondentName} is` : "I am"}
              </p>
              <h2 className="text-3xl font-bold leading-[1.1] tracking-tight text-white">
                {identity.label}
              </h2>
              <p className="max-w-[230px] text-xs leading-relaxed text-white/80">
                {identity.summary}
              </p>
            </div>

            {/* Bottom: footer */}
            <div className="flex items-end justify-between">
              <p className="max-w-[160px] text-[10px] uppercase leading-tight tracking-wider text-white/45">
                Sarvam Pulse
              </p>
              <span className="font-mono text-[10px] text-white/55">
                pulse.sarvam.ai
              </span>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
