"use client";

let ctx: AudioContext | null = null;
let muted = false;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      return null;
    }
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

export function setSoundMuted(m: boolean) {
  muted = m;
}

function play(
  freq: number,
  type: OscillatorType,
  duration: number,
  volume: number,
  ramp?: "up" | "down"
) {
  if (muted) return;
  const c = getCtx();
  if (!c) return;

  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.value = 0;
  osc.connect(gain);
  gain.connect(c.destination);

  const now = c.currentTime;
  if (ramp === "up") {
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(volume, now + duration * 0.3);
    gain.gain.linearRampToValueAtTime(0, now + duration);
  } else if (ramp === "down") {
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
  } else {
    gain.gain.setValueAtTime(volume, now);
    gain.gain.linearRampToValueAtTime(0, now + duration);
  }

  osc.start(now);
  osc.stop(now + duration);
}

/** Subtle tick for stage transitions */
export function playTick() {
  play(880, "sine", 0.08, 0.06, "down");
}

/** Soft whoosh for reflection appearance */
export function playWhoosh() {
  if (muted) return;
  const c = getCtx();
  if (!c) return;

  const osc = c.createOscillator();
  const gain = c.createGain();
  const filter = c.createBiquadFilter();

  osc.type = "sawtooth";
  filter.type = "lowpass";
  filter.frequency.value = 400;

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(c.destination);

  const now = c.currentTime;
  osc.frequency.setValueAtTime(200, now);
  osc.frequency.linearRampToValueAtTime(600, now + 0.3);
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.04, now + 0.1);
  gain.gain.linearRampToValueAtTime(0, now + 0.4);

  osc.start(now);
  osc.stop(now + 0.4);
}
