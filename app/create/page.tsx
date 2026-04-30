"use client";

import { useEffect, useState, Suspense, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Trash2, Check } from "lucide-react";
import { FlutedGlass } from "@paper-design/shaders-react";
import type { FormTone } from "@/lib/types";
import { getBgColor } from "@/lib/card-colors";

// =============================================================================
// Types
// =============================================================================

/**
 * Creator-facing input types — `name` is excluded because the form-generation
 * pipeline auto-inserts the name question (Phase 1 architectural decision).
 * Keeping this enum locally so the dropdown's options can never accidentally
 * include `name`.
 */
type CreatorInputType =
  | "voice"
  | "text"
  | "emoji_slider"
  | "cards"
  | "ranking"
  | "this_or_that"
  | "visual_select";

const INPUT_TYPE_OPTIONS: { value: CreatorInputType; label: string; hint: string }[] = [
  { value: "voice", label: "Voice", hint: "1–3 sentences spoken" },
  { value: "text", label: "Text", hint: "1–3 sentences typed" },
  { value: "emoji_slider", label: "Emoji slider", hint: "0–100 with two endpoint labels" },
  { value: "cards", label: "Cards", hint: "Pick one from 4–6 options" },
  { value: "ranking", label: "Ranking", hint: "Drag-rank 4 items" },
  { value: "this_or_that", label: "This or that", hint: "Pick one of two contrasts" },
  { value: "visual_select", label: "Visual select", hint: "Pick a visual concept" },
];

interface DraftQuestion {
  _id: string;
  intent: string;
  input_type: CreatorInputType;
}

const TONE_OPTIONS: { value: FormTone; label: string; description: string }[] = [
  { value: "playful", label: "Playful", description: "warm, conversational, a touch of wit" },
  { value: "calm", label: "Calm", description: "slow, considered, gentle" },
  { value: "direct", label: "Direct", description: "crisp, no preamble" },
  { value: "insightful", label: "Insightful", description: "evocative, thoughtful" },
];

// =============================================================================
// Validation
// =============================================================================

const TITLE_MIN = 1;
const TITLE_MAX = 100;
const INTENT_MIN = 10;
const INTENT_MAX = 300;
const Q_INTENT_MIN = 10;
const Q_INTENT_MAX = 200;

interface ValidationErrors {
  title?: string;
  intent?: string;
  questions?: Record<string, string>;
}

function validate(state: {
  title: string;
  intent: string;
  questions: DraftQuestion[];
}): ValidationErrors | null {
  const errors: ValidationErrors = {};
  const t = state.title.trim();
  if (t.length < TITLE_MIN) errors.title = "Give your form a title.";
  else if (t.length > TITLE_MAX) errors.title = `Keep it under ${TITLE_MAX} characters.`;

  const i = state.intent.trim();
  if (i.length < INTENT_MIN)
    errors.intent = `Tell us a bit more — at least ${INTENT_MIN} characters.`;
  else if (i.length > INTENT_MAX)
    errors.intent = `Keep it under ${INTENT_MAX} characters.`;

  if (state.questions.length === 0) {
    errors.questions = { _global: "Add at least one question." };
  } else {
    const qErrors: Record<string, string> = {};
    state.questions.forEach((q) => {
      const qi = q.intent.trim();
      if (qi.length < Q_INTENT_MIN)
        qErrors[q._id] = `At least ${Q_INTENT_MIN} characters — what do you want to know?`;
      else if (qi.length > Q_INTENT_MAX)
        qErrors[q._id] = `Keep it under ${Q_INTENT_MAX} characters.`;
    });
    if (Object.keys(qErrors).length > 0) errors.questions = qErrors;
  }

  if (
    !errors.title &&
    !errors.intent &&
    !errors.questions
  ) {
    return null;
  }
  return errors;
}

// =============================================================================
// Loading state — stage-indicator copy
// =============================================================================

const LOADING_STAGES = [
  { from: 0, copy: "Composing your questions in your tone…" },
  { from: 12, copy: "Imagining ten different people answering…" },
  { from: 26, copy: "Listening to how they'd respond…" },
  { from: 40, copy: "Finding the patterns that make reflections meaningful…" },
  { from: 52, copy: "Almost ready…" },
];

function GeneratingOverlay({ bgColor }: { bgColor: string }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const t = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 500);
    return () => clearInterval(t);
  }, []);

  const stage = [...LOADING_STAGES].reverse().find((s) => elapsed >= s.from)
    ?? LOADING_STAGES[0];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
      className="fixed inset-0 z-50 flex items-center justify-center"
    >
      <div className="absolute inset-0" style={{ background: bgColor }} />
      {/* Soft pulsing tint to give the wait some life */}
      <motion.div
        className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.07),transparent_70%)]"
        animate={{ opacity: [0.5, 0.9, 0.5] }}
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
      />
      <div className="relative z-10 flex max-w-xl flex-col items-center gap-8 px-8 text-center">
        {/* Single soft dot, slow pulse */}
        <motion.div
          className="h-3 w-3 rounded-full bg-white"
          style={{ boxShadow: "0 0 24px rgba(255,255,255,0.65)" }}
          animate={{ scale: [1, 1.35, 1], opacity: [0.7, 1, 0.7] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
        />
        <AnimatePresence mode="wait">
          <motion.p
            key={stage.from}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="font-display text-[1.6rem] leading-snug text-white md:text-[2rem]"
          >
            {stage.copy}
          </motion.p>
        </AnimatePresence>
        <p className="font-matter text-sm text-white/55">
          This takes about a minute. Don&apos;t close the tab.
        </p>
      </div>
    </motion.div>
  );
}

// =============================================================================
// Tone picker
// =============================================================================

function TonePicker({
  value,
  onChange,
}: {
  value: FormTone;
  onChange: (t: FormTone) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {TONE_OPTIONS.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={
              "rounded-full border px-4 py-2 text-sm font-medium transition-all " +
              (active
                ? "border-zinc-900 bg-zinc-900 text-white"
                : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300")
            }
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// =============================================================================
// Question row
// =============================================================================

function QuestionRow({
  question,
  index,
  canRemove,
  error,
  onChange,
  onRemove,
}: {
  question: DraftQuestion;
  index: number;
  canRemove: boolean;
  error?: string;
  onChange: (q: DraftQuestion) => void;
  onRemove: () => void;
}) {
  const inputTypeMeta = INPUT_TYPE_OPTIONS.find((o) => o.value === question.input_type);
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="rounded-2xl bg-white p-5 shadow-[0_2px_18px_rgba(8,18,40,0.06)]"
    >
      <div className="flex items-center justify-between pb-4">
        <p className="font-matter text-sm font-medium text-zinc-400">
          Question {index + 1}
        </p>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove question ${index + 1}`}
            className="rounded-full p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="space-y-4">
        <div>
          <label className="font-matter mb-2 block text-sm font-medium text-zinc-500">
            What do you want to know?
          </label>
          <textarea
            placeholder="e.g. how anxious people feel about AI taking jobs"
            value={question.intent}
            onChange={(e) => onChange({ ...question, intent: e.target.value })}
            rows={2}
            maxLength={Q_INTENT_MAX + 20}
            className={
              "font-matter w-full resize-none rounded-xl border bg-white px-4 py-3 text-[15px] leading-relaxed text-zinc-900 outline-none transition-colors placeholder:text-zinc-300 " +
              (error
                ? "border-red-300 focus:border-red-400"
                : "border-zinc-200 focus:border-zinc-400")
            }
          />
          {error && (
            <p className="font-matter mt-2 text-xs text-red-500">{error}</p>
          )}
        </div>

        <div>
          <label className="font-matter mb-2 block text-sm font-medium text-zinc-500">
            How should they answer?
          </label>
          <div className="relative">
            <select
              value={question.input_type}
              onChange={(e) =>
                onChange({
                  ...question,
                  input_type: e.target.value as CreatorInputType,
                })
              }
              className="font-matter w-full appearance-none rounded-xl border border-zinc-200 bg-white px-4 py-3 pr-10 text-[15px] text-zinc-900 outline-none transition-colors focus:border-zinc-400"
            >
              {INPUT_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xs text-zinc-400">
              ▾
            </span>
          </div>
          {inputTypeMeta && (
            <p className="font-matter mt-2 text-xs text-zinc-400">
              {inputTypeMeta.hint}
            </p>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// =============================================================================
// Appearance picker
// =============================================================================

const APPEARANCES = [
  { image: "/paper-image.jpg",        label: "Blue" },
  { image: "/paper-image-orange.jpg", label: "Orange" },
  { image: "/paper-image-green.jpg",  label: "Green" },
  { image: "/paper-image-red.jpg",    label: "Red" },
  { image: "/paper-image-yello.jpg",  label: "Yellow" },
] as const;

function ShaderThumb({ image, selected, onClick }: { image: string; selected: boolean; onClick: () => void }) {
  const rafRef = useRef<number | null>(null);
  const phaseRef = useRef(0);
  const [shift, setShift] = useState(0.7);
  const [stretch, setStretch] = useState(0.2);

  useEffect(() => {
    function tick() {
      phaseRef.current += 0.002;
      setShift(0.7 + Math.sin(phaseRef.current) * 0.05);
      setStretch(0.2 + Math.sin(phaseRef.current + Math.PI / 2) * 0.04);
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, []);

  return (
    <button
      type="button"
      onClick={onClick}
      className="relative flex flex-1 flex-col items-center gap-2"
    >
      <div
        className={
          "relative w-full overflow-hidden rounded-xl transition-all duration-200 " +
          (selected ? "ring-2 ring-zinc-900 ring-offset-2 ring-offset-white" : "opacity-60 hover:opacity-80")
        }
        style={{ aspectRatio: "3/4" }}
      >
        <FlutedGlass
          width="100%"
          height="100%"
          image={image}
          colorBack="#ffffff00"
          colorShadow="#000133"
          colorHighlight="#0017ad"
          size={1}
          shadows={0}
          highlights={0}
          shape="pattern"
          angle={0}
          distortionShape="cascade"
          distortion={0.67}
          shift={shift}
          stretch={stretch}
          blur={0.56}
          edges={0.56}
          margin={0}
          marginLeft={0}
          marginRight={0}
          marginTop={0}
          marginBottom={0}
          grainMixer={0.08}
          grainOverlay={0.15}
          scale={4}
          rotation={0}
          offsetX={-0.65}
          offsetY={0.55}
          fit="contain"
          originX={0}
          originY={0}
          minPixelRatio={2}
        />
        {selected && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-white">
              <Check className="h-3.5 w-3.5 text-zinc-900" />
            </div>
          </div>
        )}
      </div>
    </button>
  );
}

// =============================================================================
// Page
// =============================================================================

function CreatePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const ci = parseInt(searchParams.get("ci") ?? "0", 10);
  const bgColor = getBgColor(ci);
  const [title, setTitle] = useState("");
  const [intent, setIntent] = useState("");
  const [tone, setTone] = useState<FormTone>("insightful");
  const [anonymous, setAnonymous] = useState(false);
  const [appearance, setAppearance] = useState<string>(APPEARANCES[0].image);
  const [questions, setQuestions] = useState<DraftQuestion[]>(() => [
    { _id: crypto.randomUUID(), intent: "", input_type: "voice" },
  ]);

  const [errors, setErrors] = useState<ValidationErrors | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<{
    kind: "validation" | "sarvam" | "generic";
    message: string;
  } | null>(null);

  function addQuestion() {
    setQuestions((qs) => [
      ...qs,
      { _id: crypto.randomUUID(), intent: "", input_type: "voice" },
    ]);
  }

  function removeQuestion(id: string) {
    setQuestions((qs) => qs.filter((q) => q._id !== id));
  }

  function updateQuestion(updated: DraftQuestion) {
    setQuestions((qs) => qs.map((q) => (q._id === updated._id ? updated : q)));
  }

  async function handleSubmit() {
    setServerError(null);
    const v = validate({ title, intent, questions });
    if (v) {
      setErrors(v);
      return;
    }
    setErrors(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/forms/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          formTitle: title.trim(),
          formIntent: intent.trim(),
          tone,
          anonymous,
          appearance,
          questionIntents: questions.map((q) => ({
            intent: q.intent.trim(),
            input_type: q.input_type,
          })),
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
          message?: string;
        } | null;
        if (res.status === 400) {
          setServerError({
            kind: "validation",
            message:
              body?.message ?? body?.error ?? "Something in your form needs a tweak.",
          });
        } else if (res.status === 502) {
          setServerError({
            kind: "sarvam",
            message:
              "Couldn't generate your form right now — Sarvam is having trouble. Try again in a moment.",
          });
        } else {
          setServerError({
            kind: "generic",
            message:
              body?.message ??
              body?.error ??
              `Something went wrong (status ${res.status}).`,
          });
        }
        setSubmitting(false);
        return;
      }

      const { id } = (await res.json()) as { id: string };
      // Successful generation — go straight to the live form. The takeover
      // overlay stays mounted until the page navigates away, so the user
      // doesn't see the form re-flash.
      router.push(`/respond/${id}`);
    } catch (e) {
      setServerError({
        kind: "generic",
        message: e instanceof Error ? e.message : "Network error.",
      });
      setSubmitting(false);
    }
  }

  const titleErr = errors?.title;
  const intentErr = errors?.intent;
  const qErrs = errors?.questions ?? {};

  return (
    <div className="relative min-h-screen w-full">
      {/* Background — round-robin color matching the new form's card color */}
      <div className="fixed inset-0 z-0 transition-colors duration-500" style={{ background: bgColor }} />
      <div className="fixed inset-0 z-0 bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.05),transparent_65%)]" />

      <div className="relative z-10 mx-auto w-full max-w-2xl px-6 py-16 md:px-8 md:py-20">
        {/* Header */}
        <div className="mb-10">
          <h1 className="font-display text-[2.25rem] leading-tight tracking-tight text-white md:text-[2.875rem]">
            Create a Pulse form
          </h1>
        </div>

        {/* Form meta — single white card */}
        <div className="rounded-2xl bg-white p-6 shadow-[0_2px_24px_rgba(8,18,40,0.08)] md:p-7">
          <div className="space-y-6">
            <div>
              <label className="font-matter mb-2 block text-sm font-medium text-zinc-500">
                Title
              </label>
              <input
                type="text"
                placeholder="e.g. Living with AI in 2026"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={TITLE_MAX + 10}
                className={
                  "font-matter w-full rounded-xl border bg-white px-4 py-3 text-[15px] text-zinc-900 outline-none transition-colors placeholder:text-zinc-300 " +
                  (titleErr
                    ? "border-red-300 focus:border-red-400"
                    : "border-zinc-200 focus:border-zinc-400")
                }
              />
              {titleErr && (
                <p className="font-matter mt-2 text-xs text-red-500">{titleErr}</p>
              )}
            </div>

            <div>
              <label className="font-matter mb-2 block text-sm font-medium text-zinc-500">
                Intent
              </label>
              <textarea
                placeholder="What do you want to learn from this form?"
                value={intent}
                onChange={(e) => setIntent(e.target.value)}
                rows={3}
                maxLength={INTENT_MAX + 20}
                className={
                  "font-matter w-full resize-none rounded-xl border bg-white px-4 py-3 text-[15px] leading-relaxed text-zinc-900 outline-none transition-colors placeholder:text-zinc-300 " +
                  (intentErr
                    ? "border-red-300 focus:border-red-400"
                    : "border-zinc-200 focus:border-zinc-400")
                }
              />
              {intentErr ? (
                <p className="font-matter mt-2 text-xs text-red-500">{intentErr}</p>
              ) : (
                <p className="font-matter mt-2 text-xs text-zinc-400">
                  1–3 sentences. Beyond the headline — what would you actually want a respondent to say?
                </p>
              )}
            </div>

            <div>
              <label className="font-matter mb-2.5 block text-sm font-medium text-zinc-500">
                Tone
              </label>
              <TonePicker value={tone} onChange={setTone} />
              <p className="font-matter mt-2 text-xs text-zinc-400">
                {TONE_OPTIONS.find((t) => t.value === tone)?.description}
              </p>
            </div>

            <button
              type="button"
              onClick={() => setAnonymous((v) => !v)}
              className={
                "flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-colors " +
                (anonymous
                  ? "border-zinc-200 bg-zinc-50"
                  : "border-zinc-150 bg-zinc-50 hover:bg-zinc-100")
              }
            >
              <span
                className={
                  "mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border " +
                  (anonymous
                    ? "border-zinc-900 bg-zinc-900 text-white"
                    : "border-zinc-300 bg-white")
                }
              >
                {anonymous && (
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                    <path d="M2.5 6.5L5 9L9.5 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
              <span>
                <span className="font-matter block text-sm font-medium text-zinc-900">
                  Anonymous
                </span>
                <span className="font-matter mt-0.5 block text-xs text-zinc-500">
                  Hide respondent names. Skip the name question entirely.
                </span>
              </span>
            </button>
          </div>
        </div>

        {/* Appearance */}
        <div className="mt-10">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="font-display text-xl text-white md:text-2xl">Appearance</h2>
          </div>
          <div className="rounded-2xl bg-white px-5 py-5 shadow-[0_2px_24px_rgba(8,18,40,0.08)]">
            <div className="flex gap-3">
              {APPEARANCES.map((opt) => (
                <ShaderThumb
                  key={opt.image}
                  image={opt.image}
                  selected={appearance === opt.image}
                  onClick={() => setAppearance(opt.image)}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Questions */}
        <div className="mt-10 mb-3 flex items-baseline justify-between">
          <h2 className="font-display text-xl text-white md:text-2xl">Questions</h2>
          <p className="font-matter text-xs text-white/55">
            {questions.length} {questions.length === 1 ? "question" : "questions"}
          </p>
        </div>

        <div className="space-y-3">
          <AnimatePresence initial={false}>
            {questions.map((q, i) => (
              <QuestionRow
                key={q._id}
                question={q}
                index={i}
                canRemove={questions.length > 1}
                error={qErrs[q._id]}
                onChange={updateQuestion}
                onRemove={() => removeQuestion(q._id)}
              />
            ))}
          </AnimatePresence>
          {qErrs._global && (
            <p className="font-matter text-xs text-red-200">{qErrs._global}</p>
          )}
        </div>

        <button
          type="button"
          onClick={addQuestion}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-white/30 bg-white/[0.04] py-3.5 text-sm font-medium text-white/80 transition-colors hover:border-white/45 hover:bg-white/[0.07]"
        >
          <Plus className="h-4 w-4" />
          Add question
        </button>

        {/* Server error banner */}
        <AnimatePresence>
          {serverError && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="mt-6 rounded-2xl border border-red-200/30 bg-red-500/10 p-4 backdrop-blur"
            >
              <p className="font-matter text-sm font-medium text-white">
                {serverError.message}
              </p>
              {serverError.kind === "sarvam" && (
                <button
                  type="button"
                  onClick={handleSubmit}
                  className="font-matter mt-3 rounded-full bg-white px-4 py-1.5 text-xs font-medium text-zinc-900 transition-colors hover:bg-white/90"
                >
                  Try again
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Submit */}
        <div className="mt-10 flex justify-end">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="font-matter group relative isolate flex h-14 items-center justify-center overflow-hidden rounded-full bg-[#111820] px-10 text-base font-medium text-white shadow-[0_18px_45px_rgba(4,12,28,0.34)] transition-transform hover:scale-[1.02] hover:bg-[#0b1118] disabled:opacity-50"
          >
            <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_24%_12%,rgba(255,255,255,0.16),transparent_30%)]" />
            <span className="pointer-events-none absolute -left-12 top-0 h-full w-12 -skew-x-12 bg-white/30 blur-lg transition-transform duration-700 group-hover:translate-x-64" />
            <span className="relative z-10">Generate form →</span>
          </button>
        </div>
      </div>

      {/* Loading takeover */}
      <AnimatePresence>{submitting && <GeneratingOverlay bgColor={bgColor} />}</AnimatePresence>
    </div>
  );
}

export default function CreatePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0E1A6B]" />}>
      <CreatePageInner />
    </Suspense>
  );
}
