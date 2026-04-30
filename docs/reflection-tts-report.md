# Reflection TTS + Typewriter — Implementation Report

## Step 0 — headline field identified

The headline string lives at **`reflection.copy`** (a `string`).

Defined in [`lib/reflection.ts:13-18`](lib/reflection.ts:13):

```ts
export interface ReflectionResult {
  type: ReflectionType;
  copy: string;          // ← this
  payload: Record<string, unknown>;
  source?: "llm" | "fallback";
}
```

Rendered as the prominent serif headline in 6 places across 4 components (3 in `Reflection.tsx`, 1 each in the layout components):

| File | Line | Tag | Notes |
|---|---|---|---|
| `components/Reflection.tsx` | 559 | `<motion.h1>` | split-layout, no-right-visual branch |
| `components/Reflection.tsx` | 604 | `<motion.h1>` | split-layout, with-right-visual branch |
| `components/Reflection.tsx` | 687 | `<motion.p>` | non-split (legacy) layout |
| `components/reflection/ReflectionTribe.tsx` | 28 | `<motion.h2>` | gated by `!hideHeadline` |
| `components/reflection/ReflectionSlider.tsx` | 165 | `<motion.h2>` | gated by `!hideHeadline` |
| `components/reflection/ReflectionDistribution.tsx` | 89 | `<motion.h2>` | gated by `!hideHeadline` |

Single string field, no concatenation, no conditional fragments. `tribe.payload.quotes` are rendered separately and intentionally NOT part of TTS.

## Files modified

- `components/Reflection.tsx` — added `tone` / `muted` / `onSpeakingChange` props, `reflectionTTSDisplayText` / `reflectionTTSDone` state, removed the `CONTINUE_READY_MS` (5 s) and `AUTO_ADVANCE_MS` (9 s) timers, replaced with a single `CONTINUE_AFTER_TTS_MS` (1 s) effect keyed on `reflectionTTSDone`. Mounts a single `<TTSPlayer>` in a fixed-position container, swaps every `{copy}` headline render to `{headlineText}` where `headlineText = reflectionTTSDisplayText || copy`. Passes `displayText={reflectionTTSDisplayText}` into all three layout components.
- `components/reflection/ReflectionTribe.tsx` — adds optional `displayText` prop, renders `displayText || copy` in the `<motion.h2>`.
- `components/reflection/ReflectionSlider.tsx` — same.
- `components/reflection/ReflectionDistribution.tsx` — same.
- `app/respond/[formId]/RespondentFlow.tsx` — passes `tone={form.tone}`, `muted={muted}`, `onSpeakingChange={handleSpeakingChange}` to `<Reflection>` (single call site).

**Untouched** — `TTSPlayer.tsx`, `lib/reflection.ts`, `lib/schemas.ts`, `lib/types.ts`, every API route, the question TTS path in RespondentFlow.tsx (i.e. lines around the QuestionStage TTS handling), the reflection layouts' visual content beyond the headline render, every reaction-button path, BackgroundMusic component.

## Wiring at a glance

Per reflection lifecycle:

1. Reflection mounts with `reflectionTTSDisplayText=""` and `reflectionTTSDone=false`. Headline renders the full `copy` (because `"" || copy === copy`).
2. `<TTSPlayer text={copy} tone={tone} muted={muted} preloadedAudioUrl={null}>` mounts in a fixed bottom-left container. It fires `POST /api/tts` and starts playback.
3. As audio plays, TTSPlayer ticks `onDisplayedTextChange(textSoFar, false)` every 28 ms → state setter writes `reflectionTTSDisplayText = textSoFar`. Headline now shows the typewriter-revealed substring.
4. Audio ends → `onDisplayedTextChange(fullText, true)` → state setters: `reflectionTTSDisplayText = fullText`, `reflectionTTSDone = true`.
5. `useEffect` keyed on `reflectionTTSDone` schedules a 1 s `setTimeout` to set `showContinue = true`. Continue button fades in.
6. User clicks Continue (or reaction triggers existing 1.2 s advance) → parent's `onDone()` runs → REFLECTION stage exits → Reflection unmounts → state reset is implicit via remount.

For background music ducking: `<TTSPlayer onSpeakingChange={onSpeakingChange}>` calls back into the parent's `handleSpeakingChange` (which already manages `isSpeaking` for question TTS). `<BackgroundMusic ducking={isSpeaking}>` ducks during reflection TTS without any extra wiring.

For TTS failure: TTSPlayer's existing error handler calls `onDisplayedTextChange(text, true)` → `reflectionTTSDone = true` → Continue appears 1 s later. Headline shows full `copy` immediately because `reflectionTTSDisplayText` was last set to `text` (the full copy). Form remains usable, no audio.

## Verification

### Build / type / lint

- `npx tsc --noEmit` — passes.
- `npm run build` — passes.
- `npx eslint .` — **18 problems (11 errors, 7 warnings)** — flat from the previous phase. No new errors or warnings introduced.

### Browser test (headless gating limitation)

The dev preview's autoplay/user-gesture gate refuses to progress past `handleStart` in this environment. Same limitation flagged in `docs/tts-fix-report.md` from the previous phase. Programmatic clicks (`.click()`, `dispatchEvent(new PointerEvent)`, `preview_click`) fire visibly but `setStarting(true)` doesn't commit, the entry screen stays mounted, no `/api/sessions` POST fires, and we never reach a question — let alone a reflection. None of the standard escape hatches I tried (overriding `getUserMedia`, patching `AudioContext.resume`, page reload + interceptor re-install) gets past the gate.

What I verified by reading the new code:

- **TTSPlayer mounted exactly once per reflection** in all three layout branches (split + no-visual, split + visual, non-split). Key is the static string `"reflection-tts"`. Reflection naturally remounts per reflection because the parent's `<motion.div key="reflection">` wraps a fresh tree on each REFLECTION stage entry, so the static key is correct — there's no in-place reflection swap to handle.
- **TTSPlayer's text prop** is `copy` (the immutable, full headline string), not `displayText`. So TTSPlayer's internal effect `[text, tone, preloadedAudioUrl]` re-runs only if `tone` or `muted` change — which they don't during a single reflection's lifetime.
- **Per-reflection: 1 `/api/tts` request, 0 `/api/phrase-question` requests.** Reflection copy comes pre-generated from the `/api/answers` response (Phase 4-era behaviour); the only network call introduced by this phase is one TTS audio fetch when the reflection mounts.
- **All 5 reflection types** (`comparison`, `majority`, `minority`, `tribe`, `emotion`) hit one of the three Reflection.tsx render branches, and each branch now sources its headline from `headlineText` / `displayText`. None of the branches were skipped.
- **LLM and fallback copy treated identically**: both arrive in `reflection.copy` and flow through the same render. No code path special-cases `reflection.source`.

### Continue button timing (by code review)

Old: `setShowContinue(true)` after a fixed 5 s, plus a 9 s silent auto-advance. New: `setShowContinue(true)` 1 s after `reflectionTTSDone` flips true. Auto-advance removed entirely. The reaction-triggered 1.2 s advance is preserved because the user explicitly clicked a reaction — that's not a silent timer.

### Tribe headline vs. quotes

`ReflectionTribe` renders `<motion.h2>{headlineText}</motion.h2>` then iterates `quotes.slice(0, 3)` for the quote cards below. `displayText` only feeds the H2; quotes are rendered statically as before. TTS reads the headline only, exactly as the spec required.

## Items wanting human review

1. **Headless E2E is still blocked.** Same as the prior phase. To actually exercise the audio + typewriter path in CI we'd need a real-Chromium harness with `--autoplay-policy=no-user-gesture-required`, or a test-only seam in `handleStart` that bypasses `getUserMedia`. Out of scope here.
2. **First-frame gap is real.** Reflection mounts → TTSPlayer fetches `/api/tts` (~1–3 s on Sarvam Bulbul) → audio starts. During that gap, the headline is fully visible (no typewriter, just the static copy), there's no audio, and Continue is hidden. If the gap stretches (Sarvam slow), the user sits looking at silent text. Acceptable per spec but worth noting.
3. **Negative-test path: no TTS = ~1-2 s to Continue.** If `/api/tts` errors, TTSPlayer's `onerror` immediately calls `onDisplayedTextChange(text, true)`, setting `reflectionTTSDone = true`. Continue appears 1 s later. User can still proceed. Confirmed by reading TTSPlayer's audio.onerror handler — no code change needed.
4. **Reaction → advance still bypasses Continue.** A user can react to a reflection at any time during TTS playback, and the existing `REACTION_ADVANCE_MS` (1.2 s) still fires `advance()`. This means the user can skip the headline before TTS finishes by clicking a reaction. Spec's section "Reaction buttons may appear before TTS finishes — only Continue is gated." explicitly accepts this. Not changing it.
5. **TTSPlayer position collision check passed by reading code.** Question TTSPlayer (mounted in RespondentFlow.tsx) and Reflection TTSPlayer both render at `fixed bottom-4 left-4 z-50`. They never overlap because the question one is gated on `stage === "QUESTION" || stage === "FOLLOWUP"`, and `goToReflection()` clears `phrasedForTTS` before flipping stage to REFLECTION (which unmounts the question TTSPlayer). The reflection one only renders inside `<Reflection>` which only mounts during REFLECTION. Disjoint by construction.
6. **`muted` is forwarded but never read here.** It just passes through to TTSPlayer, which respects the volume setting via its existing internal effect. If the user unmutes mid-reflection, audio volume updates without a TTSPlayer remount (volume is decoupled from the fetch effect). No code change required.
7. **Reflection still has its existing `<EmojiBar>` in all three branches.** Reactions can be clicked during TTS playback. Spec calls this acceptable; no gating added.
8. **Static key `"reflection-tts"`.** Because Reflection remounts per reflection (parent's `<motion.div key="reflection">` wraps a fresh tree on each REFLECTION entry), the static key is correct. If anyone later changes the parent to keep Reflection mounted across reflections (e.g. for cross-reflection animation continuity), this key would need to flip to `${questionId}` or similar — flagging for that future change.
9. **`/api/tts` is unconditional per reflection.** No caching, no preload. Each reflection mounts → 1 TTS request. Across 4 questions = up to 4 reflection TTS calls + 4 question TTS calls = 8 `/api/tts` per session, on top of the persona-seeding count from form creation. Worth noting if Sarvam Bulbul TTS pricing or rate limits become a concern.
