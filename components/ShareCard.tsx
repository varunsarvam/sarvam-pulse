"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import { StaticRadialGradient } from "@paper-design/shaders-react";
import { Share2, Check } from "lucide-react";
import type { FormTone } from "@/lib/types";
import { getCardPalette } from "@/components/CompleteStage";

const CARD_W = 300;
const CARD_H = 380;

interface ShareCardProps {
  sessionId: string;
  identityLabel: string;
  identitySummary: string;
  respondentName: string | null;
  formId: string;
  formTitle: string;
  formTone: FormTone;
}

export function ShareCard({
  sessionId,
  identityLabel,
  identitySummary,
  respondentName,
  formId,
  formTone,
}: ShareCardProps) {
  const palette = getCardPalette(sessionId);

  const [focalAngle, setFocalAngle] = useState(0);
  const [focalDistance, setFocalDistance] = useState(0);
  const [copied, setCopied] = useState(false);

  const tiltRef = useRef<HTMLDivElement>(null);
  const shineRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const cur = useRef({ rx: 0, ry: 0, angle: 0, dist: 0 });
  const tgt = useRef({ rx: 0, ry: 0, angle: 0, dist: 0 });

  const setFocal = useCallback((angle: number, dist: number) => {
    setFocalAngle(angle);
    setFocalDistance(dist);
  }, []);

  useEffect(() => {
    function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
    function lerpAngle(a: number, b: number, t: number) {
      const diff = ((b - a + 540) % 360) - 180;
      return (a + diff * t + 360) % 360;
    }

    function loop() {
      const c = cur.current;
      const tg = tgt.current;
      c.rx = lerp(c.rx, tg.rx, 0.08);
      c.ry = lerp(c.ry, tg.ry, 0.08);
      c.dist = lerp(c.dist, tg.dist, 0.05);
      c.angle = lerpAngle(c.angle, tg.angle, 0.05);
      if (tiltRef.current) {
        tiltRef.current.style.transform = `perspective(1100px) rotateX(${c.rx}deg) rotateY(${c.ry}deg) scale3d(1.03,1.03,1.03)`;
      }
      if (shineRef.current) {
        shineRef.current.style.background = `radial-gradient(ellipse 115% 65% at ${48 - c.ry * 2.5}% ${22 - c.rx * 2.2}%, rgba(255,255,255,0.11), transparent 55%)`;
      }
      setFocal(c.angle, c.dist);
      rafRef.current = requestAnimationFrame(loop);
    }

    function onMouseMove(e: MouseEvent) {
      const el = tiltRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = (e.clientX - cx) / (rect.width * 0.7);
      const dy = (e.clientY - cy) / (rect.height * 0.7);
      tgt.current.rx = Math.max(-7, Math.min(7, -dy * 7));
      tgt.current.ry = Math.max(-7, Math.min(7, dx * 7));
      const mx = e.clientX - cx;
      const my = e.clientY - cy;
      tgt.current.angle = ((Math.atan2(my, mx) * 180) / Math.PI + 90 + 360) % 360;
      tgt.current.dist = Math.min(1.8, (Math.sqrt(mx * mx + my * my) / (rect.width * 0.5)) * 1.5);
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

  async function handleShare() {
    const url = window.location.href;
    const text = `I'm "${identityLabel}" on Sarvam Pulse. See what you are →`;

    if (navigator.share) {
      try {
        await navigator.share({ title: identityLabel, text, url });
        return;
      } catch {
        // fall through to clipboard
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }

  const respondUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/respond/${formId}`;

  return (
    <div
      className="relative flex min-h-screen w-full flex-col items-center justify-center gap-8 px-6 py-12"
      style={{ background: palette.colorBack }}
    >
      {/* Subtle radial glow in background */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(ellipse 70% 55% at 50% 45%, ${palette.colors[0]}22, transparent 70%)`,
        }}
      />

      {/* 3D tilt card */}
      <motion.div
        initial={{ opacity: 0, y: 28, scale: 0.9 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10"
      >
        <div ref={tiltRef} style={{ transformStyle: "preserve-3d", willChange: "transform" }}>
          <div
            className="relative overflow-hidden rounded-[28px]"
            style={{ width: CARD_W, height: CARD_H }}
          >
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
            <div ref={shineRef} className="pointer-events-none absolute inset-0" />
            <div
              className="pointer-events-none absolute inset-0 rounded-[28px]"
              style={{ boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.18), inset 0 1px 0 rgba(255,255,255,0.32)" }}
            />

            <div className="relative z-10 flex h-full flex-col p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-2.5 w-2.5 rounded-full bg-white" style={{ boxShadow: "0 0 12px rgba(255,255,255,0.7)" }} />
                  <span className="text-xs font-medium uppercase tracking-widest text-white/80">Pulse</span>
                </div>
                <span className="text-[10px] font-medium uppercase tracking-wider text-white/45">{formTone}</span>
              </div>

              <div className="flex-1" />

              <div className="flex flex-col items-center gap-2 text-center">
                <h2
                  className="text-3xl font-bold leading-[1.1] tracking-tight text-white"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  {identityLabel}
                </h2>
                <p
                  className="w-full text-[11px] leading-snug text-white/70"
                  style={{ overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}
                >
                  {identitySummary}
                </p>
                {respondentName && (
                  <span className="mt-2 font-mono text-[10px] text-white/40">{respondentName}</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Actions */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.3, ease: "easeOut" }}
        className="relative z-10 flex flex-col items-center gap-3"
      >
        {/* Share button */}
        <button
          type="button"
          onClick={handleShare}
          className="flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium text-white transition-all hover:brightness-110 active:scale-95"
          style={{
            background: "rgba(255,255,255,0.14)",
            backdropFilter: "blur(12px)",
            border: "1px solid rgba(255,255,255,0.22)",
          }}
        >
          {copied ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
          {copied ? "Link copied!" : "Share card"}
        </button>

        {/* CTA */}
        <a
          href={respondUrl}
          className="font-matter text-sm text-white/50 transition-colors hover:text-white/80"
        >
          Find out what you are →
        </a>
      </motion.div>
    </div>
  );
}
