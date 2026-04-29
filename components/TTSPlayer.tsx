"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Volume2 } from "lucide-react";

interface TTSPlayerProps {
  /** Text to speak. Changing this triggers a new fetch + playback. */
  text: string;
  tone?: string;
  muted: boolean;
  onEnded?: () => void;
  onSpeakingChange?: (speaking: boolean) => void;
  /**
   * Called each typewriter tick (28ms) while audio plays with the text revealed so far.
   * isDone = true when audio ends (or errors), indicating full text is shown.
   */
  onDisplayedTextChange?: (text: string, isDone: boolean) => void;
}

export function TTSPlayer({
  text,
  tone = "insightful",
  muted,
  onEnded,
  onSpeakingChange,
  onDisplayedTextChange,
}: TTSPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const rafRef = useRef<number | null>(null);
  const typewriterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stable callback refs — updating them doesn't re-trigger the fetch effect
  const onEndedRef = useRef(onEnded);
  const onSpeakingChangeRef = useRef(onSpeakingChange);
  const onDisplayedTextChangeRef = useRef(onDisplayedTextChange);
  useEffect(() => {
    onEndedRef.current = onEnded;
  }, [onEnded]);
  useEffect(() => {
    onSpeakingChangeRef.current = onSpeakingChange;
  }, [onSpeakingChange]);
  useEffect(() => {
    onDisplayedTextChangeRef.current = onDisplayedTextChange;
  }, [onDisplayedTextChange]);

  // Sync muted state without re-fetching audio
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = muted ? 0 : 1;
    }
  }, [muted]);

  // Fetch + play whenever text/tone changes
  useEffect(() => {
    if (!text) return;

    let cancelled = false;
    const controller = new AbortController();
    let objectUrl: string | null = null;

    async function loadAndPlay() {
      try {
        onDisplayedTextChangeRef.current?.("", false);

        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, tone }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          console.error("[TTSPlayer] bad response:", res.status);
          onDisplayedTextChangeRef.current?.(text, true);
          return;
        }

        // Blob-first path: collect all chunks then play as a single object URL.
        // Avoids MediaSource Extensions (unreliable on iOS Safari).
        const reader = res.body.getReader();
        const chunks: Uint8Array[] = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done || cancelled) break;
          if (value) chunks.push(value);
        }

        if (cancelled) return;

        const blob = new Blob(chunks, { type: "audio/mpeg" });
        objectUrl = URL.createObjectURL(blob);

        const audio = audioRef.current;
        if (!audio || cancelled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }

        audio.volume = muted ? 0 : 1;
        audio.src = objectUrl;

        audio.onplay = () => {
          setPlaying(true);
          onSpeakingChangeRef.current?.(true);

          let charIdx = 0;
          const TICK_MS = 28;
          function typewriterTick() {
            charIdx++;
            onDisplayedTextChangeRef.current?.(text.slice(0, charIdx), false);
            if (charIdx < text.length) {
              typewriterTimerRef.current = setTimeout(typewriterTick, TICK_MS);
            }
          }
          typewriterTimerRef.current = setTimeout(typewriterTick, TICK_MS);
        };

        audio.onended = () => {
          if (typewriterTimerRef.current) { clearTimeout(typewriterTimerRef.current); typewriterTimerRef.current = null; }
          if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
          onDisplayedTextChangeRef.current?.(text, true);
          setPlaying(false);
          onSpeakingChangeRef.current?.(false);
          onEndedRef.current?.();
          if (objectUrl) {
            URL.revokeObjectURL(objectUrl);
            objectUrl = null;
          }
        };

        audio.onerror = () => {
          if (typewriterTimerRef.current) { clearTimeout(typewriterTimerRef.current); typewriterTimerRef.current = null; }
          if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
          onDisplayedTextChangeRef.current?.(text, true);
          setPlaying(false);
          onSpeakingChangeRef.current?.(false);
          if (objectUrl) {
            URL.revokeObjectURL(objectUrl);
            objectUrl = null;
          }
        };

        await audio.play();
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          console.error("[TTSPlayer] load error:", e);
          onDisplayedTextChangeRef.current?.(text, true);
        }
      }
    }

    loadAndPlay();

    return () => {
      cancelled = true;
      controller.abort();
      if (typewriterTimerRef.current) { clearTimeout(typewriterTimerRef.current); typewriterTimerRef.current = null; }
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.onplay = null;
        audio.onended = null;
        audio.onerror = null;
        audio.src = "";
      }
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
      setPlaying(false);
      onSpeakingChangeRef.current?.(false);
    };
    // Only re-run when the text or voice changes, not on callback identity changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, tone]);

  return (
    <>
      {/* Hidden audio element — playback happens here */}
      <audio ref={audioRef} />

      {/* Subtle equalizer indicator — shown while playing and not muted */}
      <AnimatePresence>
        {playing && !muted && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.2 }}
            className="flex items-center gap-1.5 text-muted-foreground/50"
          >
            <Volume2 className="h-3.5 w-3.5" />
            {[0, 1, 2].map((i) => (
              <motion.span
                key={i}
                className="inline-block w-[3px] rounded-full bg-current"
                style={{ height: 14 }}
                animate={{ scaleY: [0.3, 1, 0.3] }}
                transition={{
                  duration: 0.55,
                  repeat: Infinity,
                  delay: i * 0.18,
                  ease: "easeInOut",
                }}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
