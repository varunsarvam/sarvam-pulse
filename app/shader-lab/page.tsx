"use client";

// Internal tool — not user facing

import { FlutedGlass } from "@paper-design/shaders-react";
import { useState } from "react";

type ShaderConfig = {
  image: string;
  colorBack: string;
  colorShadow: string;
  colorHighlight: string;
  size: number;
  shadows: number;
  highlights: number;
  shape: "pattern" | "wave" | "lines" | "linesIrregular" | "zigzag";
  angle: number;
  distortionShape: "prism" | "lens" | "contour" | "cascade" | "facete" | "flat";
  distortion: number;
  shift: number;
  stretch: number;
  blur: number;
  edges: number;
  margin: number;
  marginLeft: number;
  marginRight: number;
  marginTop: number;
  marginBottom: number;
  grainMixer: number;
  grainOverlay: number;
  scale: number;
  rotation: number;
  offsetX: number;
  offsetY: number;
  fit: "contain" | "cover";
  originX: number;
  originY: number;
};

const DEFAULT_CONFIG: ShaderConfig = {
  image: "/paper-image.jpg",
  colorBack: "#ffffff00",
  colorShadow: "#000133",
  colorHighlight: "#0017ad",
  size: 0.91,
  shadows: 0,
  highlights: 0,
  shape: "lines",
  angle: 0,
  distortionShape: "flat",
  distortion: 0.67,
  shift: 0.76,
  stretch: 0.4,
  blur: 0.35,
  edges: 0.73,
  margin: 0,
  marginLeft: 0,
  marginRight: 0,
  marginTop: 0,
  marginBottom: 0,
  grainMixer: 0.08,
  grainOverlay: 0.15,
  scale: 3.36,
  rotation: 0,
  offsetX: 0,
  offsetY: 0,
  fit: "contain",
  originX: 0.5,
  originY: 0.5,
};
type ShaderKey = keyof ShaderConfig;

const SHAPES = ["pattern", "wave", "lines", "linesIrregular", "zigzag"] as const;
const DISTORTION_SHAPES = ["prism", "lens", "contour", "cascade", "facete", "flat"] as const;
const FITS = ["contain", "cover"] as const;

function formatValue(value: string | number): string {
  return typeof value === "number" ? String(value) : `"${value}"`;
}

function makeCopyText(config: ShaderConfig): string {
  const json = JSON.stringify(config, null, 2);
  const jsx = Object.entries(config)
    .map(([key, value]) => `${key}=${formatValue(value)}`)
    .join("\n");

  return `// JSON\n${json}\n\n---\n\n// JSX props (paste-ready into PresenceShader)\n${jsx}`;
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <details open className="rounded-xl border border-neutral-800 bg-neutral-950/40">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
        {title}
      </summary>
      <div className="space-y-4 border-t border-neutral-800 px-4 py-4">
        {children}
      </div>
    </details>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <div className="flex justify-between">
        <span>{label}</span>
        <span className="text-neutral-400">{value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full"
      />
    </label>
  );
}

function TextInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span>{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 outline-none focus:border-neutral-400"
      />
    </label>
  );
}

function ColorInput({
  label,
  value,
  onChange,
  supportsPicker = true,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  supportsPicker?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span>{label}</span>
      <div className="flex gap-2">
        {supportsPicker && (
          <input
            type="color"
            value={value.slice(0, 7)}
            onChange={(e) => onChange(e.target.value)}
            className="h-9 w-11 rounded border border-neutral-700 bg-neutral-950"
          />
        )}
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="min-w-0 flex-1 rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 outline-none focus:border-neutral-400"
        />
      </div>
    </label>
  );
}

function SelectInput<T extends readonly string[]>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T[number];
  options: T;
  onChange: (value: T[number]) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T[number])}
        className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 outline-none focus:border-neutral-400"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function ShaderLabPage() {
  const [config, setConfig] = useState<ShaderConfig>({ ...DEFAULT_CONFIG });
  const [copied, setCopied] = useState(false);
  const shaderConfig = config as Omit<ShaderConfig, "distortionShape"> & {
    distortionShape: "prism" | "lens" | "contour" | "cascade" | "flat";
  };

  function update<K extends ShaderKey>(key: K, value: ShaderConfig[K]) {
    setConfig((current) => ({ ...current, [key]: value }));
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(makeCopyText(config));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <main className="flex h-screen w-screen overflow-hidden bg-black">
      <aside className="h-screen w-full max-w-[420px] overflow-y-auto border-r border-neutral-800 bg-neutral-900 text-neutral-100">
        <div className="sticky top-0 z-10 space-y-2 border-b border-neutral-800 bg-neutral-900/95 p-4 backdrop-blur">
          <h1 className="text-lg font-semibold">Shader Lab</h1>
          <div className="flex gap-2">
            <button
              onClick={handleCopy}
              className="rounded-md bg-neutral-100 px-3 py-2 text-sm font-medium text-neutral-950"
            >
              {copied ? "Copied!" : "Copy Config"}
            </button>
            <button
              onClick={() => setConfig({ ...DEFAULT_CONFIG })}
              className="rounded-md border border-neutral-700 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-800"
            >
              Reset
            </button>
          </div>
        </div>

        <div className="space-y-4 p-4">
          <Section title="1. Image source">
            <TextInput
              label="image"
              value={config.image}
              onChange={(value) => update("image", value)}
            />
          </Section>

          <Section title="2. Colors">
            <ColorInput
              label="colorBack"
              value={config.colorBack}
              supportsPicker={false}
              onChange={(value) => update("colorBack", value)}
            />
            <ColorInput
              label="colorShadow"
              value={config.colorShadow}
              onChange={(value) => update("colorShadow", value)}
            />
            <ColorInput
              label="colorHighlight"
              value={config.colorHighlight}
              onChange={(value) => update("colorHighlight", value)}
            />
          </Section>

          <Section title="3. Shape & geometry">
            <Slider label="size" value={config.size} min={0} max={1} step={0.01} onChange={(v) => update("size", v)} />
            <Slider label="shadows" value={config.shadows} min={0} max={1} step={0.01} onChange={(v) => update("shadows", v)} />
            <Slider label="highlights" value={config.highlights} min={0} max={1} step={0.01} onChange={(v) => update("highlights", v)} />
            <SelectInput label="shape" value={config.shape} options={SHAPES} onChange={(v) => update("shape", v)} />
            <Slider label="angle" value={config.angle} min={0} max={180} step={1} onChange={(v) => update("angle", v)} />
            <SelectInput label="distortionShape" value={config.distortionShape} options={DISTORTION_SHAPES} onChange={(v) => update("distortionShape", v)} />
            <Slider label="distortion" value={config.distortion} min={0} max={1} step={0.01} onChange={(v) => update("distortion", v)} />
          </Section>

          <Section title="4. Motion resting values">
            <Slider label="shift" value={config.shift} min={-1} max={1} step={0.01} onChange={(v) => update("shift", v)} />
            <Slider label="stretch" value={config.stretch} min={0} max={1} step={0.01} onChange={(v) => update("stretch", v)} />
          </Section>

          <Section title="5. Surface effects">
            <Slider label="blur" value={config.blur} min={0} max={1} step={0.01} onChange={(v) => update("blur", v)} />
            <Slider label="edges" value={config.edges} min={0} max={1} step={0.01} onChange={(v) => update("edges", v)} />
            <Slider label="margin" value={config.margin} min={0} max={1} step={0.01} onChange={(v) => update("margin", v)} />
            <Slider label="marginLeft" value={config.marginLeft} min={0} max={1} step={0.01} onChange={(v) => update("marginLeft", v)} />
            <Slider label="marginRight" value={config.marginRight} min={0} max={1} step={0.01} onChange={(v) => update("marginRight", v)} />
            <Slider label="marginTop" value={config.marginTop} min={0} max={1} step={0.01} onChange={(v) => update("marginTop", v)} />
            <Slider label="marginBottom" value={config.marginBottom} min={0} max={1} step={0.01} onChange={(v) => update("marginBottom", v)} />
            <Slider label="grainMixer" value={config.grainMixer} min={0} max={1} step={0.01} onChange={(v) => update("grainMixer", v)} />
            <Slider label="grainOverlay" value={config.grainOverlay} min={0} max={1} step={0.01} onChange={(v) => update("grainOverlay", v)} />
          </Section>

          <Section title="6. Common props">
            <Slider label="scale" value={config.scale} min={0.01} max={4} step={0.01} onChange={(v) => update("scale", v)} />
            <Slider label="rotation" value={config.rotation} min={0} max={360} step={1} onChange={(v) => update("rotation", v)} />
            <Slider label="offsetX" value={config.offsetX} min={-1} max={1} step={0.01} onChange={(v) => update("offsetX", v)} />
            <Slider label="offsetY" value={config.offsetY} min={-1} max={1} step={0.01} onChange={(v) => update("offsetY", v)} />
            <SelectInput label="fit" value={config.fit} options={FITS} onChange={(v) => update("fit", v)} />
            <Slider label="originX" value={config.originX} min={0} max={1} step={0.01} onChange={(v) => update("originX", v)} />
            <Slider label="originY" value={config.originY} min={0} max={1} step={0.01} onChange={(v) => update("originY", v)} />
          </Section>
        </div>
      </aside>

      <section className="relative min-w-0 flex-1">
        <FlutedGlass
          {...shaderConfig}
          width="100%"
          height="100%"
          minPixelRatio={2}
        />
      </section>
    </main>
  );
}
