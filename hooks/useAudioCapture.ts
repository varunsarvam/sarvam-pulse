"use client";

import { useRef, useState, useCallback, useEffect } from "react";

const TARGET_SAMPLE_RATE = 16_000;

// ─── WAV header builder ────────────────────────────────────────────────────────

function buildWav(samples: Int16Array, sampleRate: number): Blob {
  const dataSize = samples.byteLength;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  view.setUint8(0, 0x52); view.setUint8(1, 0x49); view.setUint8(2, 0x46); view.setUint8(3, 0x46); // "RIFF"
  view.setUint32(4, 36 + dataSize, true);
  view.setUint8(8, 0x57); view.setUint8(9, 0x41); view.setUint8(10, 0x56); view.setUint8(11, 0x45); // "WAVE"
  view.setUint8(12, 0x66); view.setUint8(13, 0x6d); view.setUint8(14, 0x74); view.setUint8(15, 0x20); // "fmt "
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);        // PCM
  view.setUint16(22, 1, true);        // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  view.setUint8(36, 0x64); view.setUint8(37, 0x61); view.setUint8(38, 0x74); view.setUint8(39, 0x61); // "data"
  view.setUint32(40, dataSize, true);
  new Int16Array(buffer, 44).set(samples);

  return new Blob([buffer], { type: "audio/wav" });
}

// ─── Internal capture state ────────────────────────────────────────────────────

interface CaptureCtx {
  audioCtx: AudioContext;
  analyser: AnalyserNode;
  worklet: AudioWorkletNode;
  stream: MediaStream;
  chunks: ArrayBuffer[];
}

// ─── Hook interface ────────────────────────────────────────────────────────────

export interface AudioCapture {
  start: () => Promise<void>;
  /** Stops recording. Returns WAV blob for server-side STT. */
  stop: () => Promise<{ blob: Blob; transcript: string | null }>;
  isRecording: boolean;
  /** Reserved for future server-side streaming STT; currently empty. */
  liveTranscript: string;
  /** Returns 0–1 overall amplitude. */
  getAmplitude: () => number;
}

export function useAudioCapture(): AudioCapture {
  const [isRecording, setIsRecording] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("");

  const ctxRef = useRef<CaptureCtx | null>(null);
  const mountedRef = useRef(true);
  // Ref tracks the latest transcript value — readable synchronously in stop()
  const lastTranscriptRef = useRef<string>("");

  const getAmplitude = useCallback((): number => {
    const c = ctxRef.current;
    if (!c) return 0;
    const data = new Uint8Array(c.analyser.frequencyBinCount);
    c.analyser.getByteFrequencyData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i];
    return Math.min(1, (sum / data.length) / 64);
  }, []);

  const stop = useCallback(async (): Promise<{ blob: Blob; transcript: string | null }> => {
    const c = ctxRef.current;
    if (!c) {
      return { blob: buildWav(new Int16Array(0), TARGET_SAMPLE_RATE), transcript: null };
    }
    ctxRef.current = null;

    // Halt PCM accumulation and tear down audio graph
    c.worklet.port.onmessage = null;
    c.worklet.disconnect();
    c.analyser.disconnect();
    c.stream.getTracks().forEach((t) => t.stop());

    const chunks = [...c.chunks];
    const actualRate = c.audioCtx.sampleRate;
    await c.audioCtx.close().catch(() => {});

    let finalTranscript: string | null = lastTranscriptRef.current || null;

    if (mountedRef.current) {
      setIsRecording(false);
      setLiveTranscript("");
    }
    lastTranscriptRef.current = "";

    // Build WAV blob (used as fallback when streaming transcript is empty)
    const totalSamples = chunks.reduce((acc, buf) => acc + buf.byteLength / 2, 0);
    const merged = new Int16Array(totalSamples);
    let offset = 0;
    for (const buf of chunks) {
      const arr = new Int16Array(buf);
      merged.set(arr, offset);
      offset += arr.length;
    }

    return { blob: buildWav(merged, actualRate), transcript: finalTranscript };
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      void stop();
    };
  }, [stop]);

  const start = useCallback(async (): Promise<void> => {
    if (ctxRef.current) return; // guard against double-start

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: TARGET_SAMPLE_RATE,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

    const audioCtx = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
    const actualRate = audioCtx.sampleRate;
    if (actualRate !== TARGET_SAMPLE_RATE) {
      console.warn(
        `[useAudioCapture] AudioContext.sampleRate = ${actualRate} (expected ${TARGET_SAMPLE_RATE}). WAV header will use actual rate.`
      );
    } else {
      console.log(`[useAudioCapture] AudioContext.sampleRate = ${actualRate} ✓`);
    }

    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    await audioCtx.audioWorklet.addModule("/pcm-processor.js");
    const worklet = new AudioWorkletNode(audioCtx, "pcm-processor");
    source.connect(worklet);

    // ── Wire everything up ──────────────────────────────────────────────────────
    const chunks: ArrayBuffer[] = [];
    ctxRef.current = { audioCtx, analyser, worklet, stream, chunks };

    worklet.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      const c = ctxRef.current;
      if (!c) return;

      c.chunks.push(e.data);
    };

    if (mountedRef.current) setIsRecording(true);
  }, []);

  return { start, stop, isRecording, getAmplitude, liveTranscript };
}
