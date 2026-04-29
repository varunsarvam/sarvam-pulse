"use client";

import type { FormTone } from "@/lib/types";

interface ShareCardProps {
  identity: {
    label: string;
    summary: string;
    highlights?: string[];
  };
  tone: FormTone;
}

const TONE_GRADIENT: Record<
  FormTone,
  { from: string; via: string; to: string; accent: string; ring: string }
> = {
  playful: {
    from: "#ea580c",
    via: "#f97316",
    to: "#ec4899",
    accent: "#fbbf24",
    ring: "rgba(251,191,36,0.45)",
  },
  calm: {
    from: "#0e7490",
    via: "#0891b2",
    to: "#3b82f6",
    accent: "#22d3ee",
    ring: "rgba(34,211,238,0.45)",
  },
  direct: {
    from: "#1f2937",
    via: "#374151",
    to: "#0f172a",
    accent: "#cbd5e1",
    ring: "rgba(203,213,225,0.35)",
  },
  insightful: {
    from: "#5b21b6",
    via: "#7c3aed",
    to: "#4f46e5",
    accent: "#c4b5fd",
    ring: "rgba(196,181,253,0.45)",
  },
};

export function ShareCard({ identity, tone }: ShareCardProps) {
  const g = TONE_GRADIENT[tone];

  return (
    <div
      className="relative w-[360px] h-[504px] rounded-3xl overflow-hidden flex flex-col justify-between p-8 shadow-2xl"
      style={{
        background: `linear-gradient(135deg, ${g.from} 0%, ${g.via} 50%, ${g.to} 100%)`,
      }}
    >
      {/* Decorative orbs */}
      <div
        className="absolute -top-16 -right-16 w-48 h-48 rounded-full blur-3xl opacity-60 pointer-events-none"
        style={{ background: g.accent }}
      />
      <div
        className="absolute -bottom-20 -left-12 w-56 h-56 rounded-full blur-3xl opacity-40 pointer-events-none"
        style={{ background: g.from }}
      />
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at top, rgba(255,255,255,0.18) 0%, transparent 60%)",
        }}
      />

      {/* Top: brand */}
      <div className="relative z-10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className="h-2.5 w-2.5 rounded-full"
            style={{
              background: "white",
              boxShadow: `0 0 12px ${g.ring}`,
            }}
          />
          <span className="text-xs font-medium tracking-widest uppercase text-white/80">
            Pulse
          </span>
        </div>
        <span className="text-[10px] font-medium tracking-wider uppercase text-white/60">
          {tone}
        </span>
      </div>

      {/* Middle: identity */}
      <div className="relative z-10 flex flex-col gap-4">
        <p className="text-xs font-medium tracking-[0.2em] uppercase text-white/70">
          I am a
        </p>
        <h2 className="text-4xl font-bold leading-[1.1] tracking-tight text-white drop-shadow-sm">
          {identity.label}
        </h2>
        <p className="text-sm leading-relaxed text-white/85 max-w-[260px]">
          {identity.summary}
        </p>
      </div>

      {/* Bottom: footer */}
      <div className="relative z-10 flex items-end justify-between">
        <p className="text-[10px] tracking-wider uppercase text-white/60 max-w-[180px] leading-tight">
          A voice-first conversational form
        </p>
        <div className="text-[10px] font-mono text-white/70">
          pulse.app
        </div>
      </div>
    </div>
  );
}
