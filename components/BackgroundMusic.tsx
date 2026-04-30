"use client";

import { useEffect, useRef } from "react";

const DEFAULT_VOLUME = 0.0325;
const DUCKED_VOLUME = 0.01;
const MUTED_VOLUME = 0;
const MUSIC_SRC = "/audio/bg-music.mp3";
const MUSIC_SIZE_BYTES = 5.9 * 1024 * 1024;

interface BackgroundMusicProps {
  active: boolean;
  ducking: boolean;
  muted: boolean;
}

function targetVolume({ muted, ducking }: { muted: boolean; ducking: boolean }) {
  if (muted) return MUTED_VOLUME;
  return ducking ? DUCKED_VOLUME : DEFAULT_VOLUME;
}

export function BackgroundMusic({
  active,
  ducking,
  muted,
}: BackgroundMusicProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const hasWarnedSizeRef = useRef(false);

  function fadeTo(volume: number, duration: number) {
    const audio = audioRef.current;
    if (!audio) return;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    const start = audio.volume;
    const startedAt = performance.now();

    function tick(now: number) {
      const t = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      if (audioRef.current) {
        audioRef.current.volume = start + (volume - start) * eased;
      }
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
  }

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (!hasWarnedSizeRef.current && MUSIC_SIZE_BYTES > 3 * 1024 * 1024) {
      console.warn(
        "[BackgroundMusic] bg-music.mp3 is over 3MB; consider compressing it for faster demos."
      );
      hasWarnedSizeRef.current = true;
    }

    if (active) {
      audio.loop = true;
      audio.volume = muted ? MUTED_VOLUME : DEFAULT_VOLUME;
      audio
        .play()
        .catch((e) =>
          console.warn("[BackgroundMusic] playback did not start:", e)
        );
    } else {
      audio.pause();
      audio.currentTime = 0;
    }
  }, [active, muted]);

  useEffect(() => {
    if (!active) return;
    const next = targetVolume({ muted, ducking });
    fadeTo(next, muted ? 200 : ducking ? 300 : 500);
  }, [active, ducking, muted]);

  useEffect(() => {
    const cleanupAudio = audioRef.current;
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (cleanupAudio) {
        cleanupAudio.pause();
        cleanupAudio.src = "";
      }
    };
  }, []);

  return <audio ref={audioRef} src={MUSIC_SRC} preload="auto" loop />;
}
