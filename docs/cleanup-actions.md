# Stabilize Build & Conservative Cleanup — Actions Log

**Date:** 2026-04-30
**Branch:** main

---

## Final status

```
Phase 1: PASS (5 / 5 enumerated errors fixed)
Phase 2: PASS
Build:   GREEN
TSC:     0 errors
ESLint:  19 errors, 4 warnings (down from 22 errors, 6 warnings)
Smoke tests: NOT RUN (no browser available in this session — see notes)
```

---

## Phase 1 — Files modified

| File | Change |
|---|---|
| `components/inputs/EmojiSlider.tsx` | `useState<unknown>(null)` → `useState<object \| null>(null)` in `useLottieData` so the hook return type narrows correctly when passed through `lottieData && <Lottie ... />`. |
| `components/reflection/ReflectionSlider.tsx` | Added `useEffect`/`useState` import + `useLottieData` hook (mirroring the EmojiSlider pattern). Replaced `<Lottie path={notoUrl(hex)} ... />` with `lottieData && <Lottie animationData={lottieData} ... />` — `path` is not in the `lottie-react` type definition. |
| `components/inputs/VoiceInput.tsx` (line 180) | Added `!canvas` to the early-return null check inside `draw()` to satisfy strict null checking on `canvas.width / canvas.height`. |
| `components/inputs/VoiceInput.tsx` (line 416) | Removed orphan `setElapsed(0)` from `handleRetry`. **Investigation:** grepped the file for `elapsed` / `Elapsed` — only one match (the deleted line). No `useState`, no related variables. Confirmed dead code from a prior refactor (probably an old elapsed-time counter replaced by the waveform shader). |
| `components/inputs/VoiceInput.tsx` (lines 224–251) | Removed the unused `TranscribingBlock` component. The replacement transcribing UI is rendered inline at line 526 (the conic-gradient spinner). |
| `components/CompleteStage.tsx` (line 146) | `let diff` → `const diff` (prefer-const). |
| `components/Reflection.tsx` (line 388) | `@ts-ignore` → `@ts-expect-error` per ESLint preference. The Lottie `path` prop still works at runtime; this stays as a deliberate, documented suppression. |
| `components/inputs/Ranking.tsx` (line 21) | Removed unused `Button` import. |
| `app/respond/[formId]/RespondentFlow.tsx` (line 1102 + new effect + line 1636) | Mirror `preloadCacheRef.current` for the current question into a new `preloadedForCurrent` state via a `useEffect` keyed on `[questionIndex, preloadProgress, questions]`. Render now reads the state instead of the ref. **Why:** `preloadProgress` updates whenever the cache is written (via `markDone()`), so the effect re-runs at the right moment without changing component lifecycle. Net change: ~10 lines. |

---

## Phase 1 — Investigation notes

### Error 4 (`setElapsed` undefined)
The variable was completely orphaned: zero `useState` declarations for an `elapsed` value, zero other references. The remaining `handleRetry` body resets only the typewriter / transcript / audio state. Decision: **remove the line.**

### Error 5 (ref-during-render in `RespondentFlow.tsx:1636`)
Stayed within the prompt's "STOP if >30 lines or lifecycle change" guardrail. The fix is a single state + a single effect (~10 lines), and the effect runs at the same logical points as the prior implicit re-renders (which were triggered by `setPreloadProgress` calls in `markDone`). Behaviour is equivalent: by the time the QUESTION stage renders, all preload entries should already have flushed into state.

---

## Phase 2 — Files modified

| File | Change |
|---|---|
| `docs/sarvam-integration.md` | (a) Auth section now says all calls use the same `api-subscription-key` header (was previously claiming a separate `Authorization: Bearer` for LLM). (b) TTS section rewritten to reflect the SDK streaming implementation (`textToSpeech.convertStream`, `bulbul:v3`, mp3 24k) and the correct voice mapping (`playful → anushka`, `calm → neha`, `direct → rahul`, `insightful → varun`). The old base64-decoded JSON shape is removed. (c) Added a note that the older `textToSpeech()` helper has been removed from `lib/sarvam.ts`. |
| `lib/sarvam.ts` | Removed unused `textToSpeech()` function and its `TTSOptions` / `TTSResult` interfaces (lines 47–83 of the original). Replaced with a 3-line comment pointing to `app/api/tts/route.ts`. |

### Phase 2c — Audit only (no changes)
Reviewed `app/respond/[formId]/RespondentFlow.tsx` lines 1578–1597. Block status:

- Wrapper div has `className="hidden"` (Tailwind `display: none`)
- Block is mounted in DOM but invisible
- TODO comment present at line 1593: `// TODO: replace with paper shader avatar synced to TTS`
- `AIPresence` is itself commented out (line 1594), with the wrapper kept as scaffolding

This matches the prompt's "hidden but rendering" case — left untouched.

---

## ESLint state

### Before

22 errors, 6 warnings.

### After

19 errors, 4 warnings.

Net change: **−3 errors, −2 warnings** (the five enumerated fixes plus collateral from removing `TranscribingBlock`).

### Errors that remain (all out of scope)

- `scripts/seed.ts`: 4× `no-explicit-any` — explicitly excluded per prompt ("the seed script is being replaced soon").
- `app/respond/[formId]/RespondentFlow.tsx`: ~15 errors in the `ReactionPopEmoji` component (lines 79–98) — `Math.random` during render in `useRef` initialiser, plus `pos.current` reads inside JSX. These are pre-existing and were not in the prompt's enumerated fix list. Touching `RespondentFlow.tsx` further is explicitly forbidden in Phase 2 ("about to be substantially modified for the form-creation rebuild").

---

## Verification I ran

| Check | Result |
|---|---|
| `npx tsc --noEmit` | 0 errors (was 4) |
| `npm run build` | Compiled successfully, all 15 routes built |
| `npx eslint .` | 19 errors / 4 warnings (was 22 / 6) |
| `grep textToSpeech` after Phase 2b | Only `client.textToSpeech.convertStream` SDK calls in `app/api/tts/route.ts` — the standalone helper is fully removed |

---

## Verification I could NOT run

| Check | Why |
|---|---|
| Manual smoke: `/`, `/create`, `/respond/[id]` render | No browser available in this session. Build success is the strongest automated signal — TSC + Next prerender pass implies no syntax / route / static-build regressions, but live render with Supabase data has not been verified end-to-end. |
| Manual smoke: voice answer end-to-end (record → STT → normalize → reflection) | Same reason. Particularly relevant given the `setElapsed` and TranscribingBlock removals — both were dead code, but the only true confirmation is a recording session. |

If you want, I can leave a dev server running so you can hit those routes yourself, or you can flag any failures and I'll diagnose.

---

## Things I noticed but didn't fix (for follow-up)

These all came up during cleanup but are explicitly out of scope or below the bar to touch right now:

1. **`ReactionPopEmoji` purity errors (`RespondentFlow.tsx:79–98`)**: `Math.random()` in a `useRef` initialiser plus `pos.current.left/top` read during render. The component renders short-lived emoji pop animations on incoming reactions. Functionally works, but ESLint flags it. Fix would be a small refactor (compute the random pos in `useMemo` keyed on the emoji id, or store in `useState`). Out of scope per the prompt.

2. **`ENTRY_GRADIENT` dead constant (`RespondentFlow.tsx:79`)**: assigned but never used. Trivial to remove but RespondentFlow is off-limits.

3. **`useAudioCapture` legacy hook (`hooks/useAudioCapture.ts`)**: snapshot called this "largely superseded by VoiceInput internals" but it's still imported and used by `VoiceInput.tsx:7`. The label in the snapshot is misleading — it's not actually unused. Worth re-examining when VoiceInput gets touched again.

4. **Phrase-question cache is unbounded (`app/api/phrase-question/route.ts`)**: was already in the snapshot's open questions; not addressed here.

5. **Hidden left-panel breathing-tint animation (`RespondentFlow.tsx:1585–1589`)**: framer-motion `animate` keyframes still execute even though the parent has `display: none`. Tiny CPU cost, but technically wasted work. Per prompt instructions, reported but not fixed.

6. **`docs/sarvam-integration.md` "Cost discipline" section** mentions a 30-second max recording duration, but `VoiceInput.tsx:21` actually allows up to 10 minutes (`MAX_DURATION_MS = 10 * 60_000`). Doc and code disagree. I didn't fix this — wasn't in the explicit Phase 2 scope and could go either way (which one is the actual product decision?).

7. **`/api/transcribe/route.ts` and `/api/tts/route.ts`** hold their own copy of `process.env.SARVAM_API_KEY` lookups separately from `lib/sarvam.ts`. Consistent with current Sarvam header use, but a centralised client helper would reduce drift if the auth scheme ever changes.
