"use client";

import { FlutedGlass } from "@paper-design/shaders-react";
import { useCallback, useEffect, useRef, useState } from "react";

export type PresenceShaderMode = "static" | "speaking" | "listening";

interface PresenceShaderProps {
  mode: PresenceShaderMode;
  className?: string;
}

const BASE_SHIFT = 0.7;
const BASE_STRETCH = 0.2;
const BASE_DISTORTION = 0.67;
const BASE_OFFSET_X = -0.65;
const BASE_OFFSET_Y = 0.55;
const BASE_SCALE = 4;
const TRANSITION_MS = 800;

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function targetForMode(mode: PresenceShaderMode) {
  if (mode === "speaking") {
    return { shiftAmp: 0.08, stretchAmp: 0.12, distortionAmp: 0.035, period: 2800 };
  }
  if (mode === "listening") {
    return { shiftAmp: 0.04, stretchAmp: 0.055, distortionAmp: 0.015, period: 4500 };
  }
  return { shiftAmp: 0, stretchAmp: 0, distortionAmp: 0, period: 2800 };
}

export function PresenceShader({ mode, className }: PresenceShaderProps) {
  const [liveShift, setLiveShift] = useState(BASE_SHIFT);
  const [liveStretch, setLiveStretch] = useState(BASE_STRETCH);
  const [liveDistortion, setLiveDistortion] = useState(BASE_DISTORTION);

  const rafRef = useRef<number | null>(null);
  const modeRef = useRef<PresenceShaderMode>(mode);
  const phaseRef = useRef(0);
  const lastFrameRef = useRef<number | null>(null);
  const currentShiftAmpRef = useRef(0);
  const currentStretchAmpRef = useRef(0);
  const currentDistortionAmpRef = useRef(0);
  const currentPeriodRef = useRef(2800);
  const targetShiftAmpRef = useRef(0);
  const targetStretchAmpRef = useRef(0);
  const targetDistortionAmpRef = useRef(0);
  const targetPeriodRef = useRef(2800);
  const transitionStartRef = useRef<number | null>(null);
  const transitionFromShiftAmpRef = useRef(0);
  const transitionFromStretchAmpRef = useRef(0);
  const transitionFromDistortionAmpRef = useRef(0);
  const transitionFromPeriodRef = useRef(2800);

  const tick = useCallback(function tick() {
    const now = performance.now();

    if (transitionStartRef.current !== null) {
      const elapsed = now - transitionStartRef.current;
      const t = Math.min(elapsed / TRANSITION_MS, 1);
      const eased = easeInOutCubic(t);

      currentShiftAmpRef.current = lerp(
        transitionFromShiftAmpRef.current,
        targetShiftAmpRef.current,
        eased
      );
      currentStretchAmpRef.current = lerp(
        transitionFromStretchAmpRef.current,
        targetStretchAmpRef.current,
        eased
      );
      currentDistortionAmpRef.current = lerp(
        transitionFromDistortionAmpRef.current,
        targetDistortionAmpRef.current,
        eased
      );
      currentPeriodRef.current = lerp(
        transitionFromPeriodRef.current,
        targetPeriodRef.current,
        eased
      );

      if (t >= 1) transitionStartRef.current = null;
    }

    const lastFrame = lastFrameRef.current ?? now;
    const delta = now - lastFrame;
    lastFrameRef.current = now;
    phaseRef.current += (delta / currentPeriodRef.current) * Math.PI * 2;

    const shiftOffset = Math.sin(phaseRef.current) * currentShiftAmpRef.current;
    const stretchOffset =
      Math.sin(phaseRef.current + Math.PI / 2) * currentStretchAmpRef.current;
    const distortionOffset =
      Math.sin(phaseRef.current + Math.PI) * currentDistortionAmpRef.current;

    setLiveShift(BASE_SHIFT + shiftOffset);
    setLiveStretch(BASE_STRETCH + stretchOffset);
    setLiveDistortion(BASE_DISTORTION + distortionOffset);

    if (
      modeRef.current === "static" &&
      currentShiftAmpRef.current < 0.001 &&
      currentStretchAmpRef.current < 0.001 &&
      currentDistortionAmpRef.current < 0.001 &&
      transitionStartRef.current === null
    ) {
      setLiveShift(BASE_SHIFT);
      setLiveStretch(BASE_STRETCH);
      setLiveDistortion(BASE_DISTORTION);
      lastFrameRef.current = null;
      rafRef.current = null;
      return;
    }

    rafRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    const now = performance.now();
    const target = targetForMode(mode);

    transitionFromShiftAmpRef.current = currentShiftAmpRef.current;
    transitionFromStretchAmpRef.current = currentStretchAmpRef.current;
    transitionFromDistortionAmpRef.current = currentDistortionAmpRef.current;
    transitionFromPeriodRef.current = currentPeriodRef.current;
    targetShiftAmpRef.current = target.shiftAmp;
    targetStretchAmpRef.current = target.stretchAmp;
    targetDistortionAmpRef.current = target.distortionAmp;
    targetPeriodRef.current = target.period;
    transitionStartRef.current = now;
    modeRef.current = mode;

    if (
      mode === "static" &&
      currentShiftAmpRef.current < 0.001 &&
      currentStretchAmpRef.current < 0.001 &&
      currentDistortionAmpRef.current < 0.001 &&
      transitionStartRef.current === null
    ) {
      setLiveShift(BASE_SHIFT);
      setLiveStretch(BASE_STRETCH);
      setLiveDistortion(BASE_DISTORTION);
      return;
    }

    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(tick);
    }
  }, [mode, tick]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, []);

  return (
    <div className={`absolute inset-0 ${className ?? ""}`}>
      <FlutedGlass
        width="100%"
        height="100%"
        image="/paper-image.jpg"
        colorBack="#ffffff00"
        colorShadow="#000133"
        colorHighlight="#0017ad"
        size={1}
        shadows={0}
        highlights={0}
        shape="pattern"
        angle={0}
        distortionShape="cascade"
        distortion={liveDistortion}
        shift={liveShift}
        stretch={liveStretch}
        blur={0.56}
        edges={0.56}
        margin={0}
        marginLeft={0}
        marginRight={0}
        marginTop={0}
        marginBottom={0}
        grainMixer={0.08}
        grainOverlay={0.15}
        scale={BASE_SCALE}
        rotation={0}
        offsetX={BASE_OFFSET_X}
        offsetY={BASE_OFFSET_Y}
        fit="contain"
        originX={0}
        originY={0}
        minPixelRatio={2}
      />
    </div>
  );
}
