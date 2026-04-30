# Phase 6.5c — Reflection Lifecycle Fixes

## Files modified

- `components/Reflection.tsx` — added `showFallbackCopy` state + 3 s safety-net effect, replaced `displayText || copy` headline render with three-state logic (typewriter / fallback / placeholder), removed reaction auto-advance (`REACTION_ADVANCE_MS` constant + `scheduleReactionAdvance` + `advanceTimerRef`).
- `app/respond/[formId]/RespondentFlow.tsx` — added `stageTransitionTimerRef`, wrapped `advanceQuestion` and `goToReflection` stage flips in 500 ms `setTimeout`, extended the unmount cleanup effect to clear the new timer + the existing `nullReflectionTimerRef`.

**Untouched** — `TTSPlayer.tsx`, `lib/reflection.ts`, the question TTS pipeline (preload, parent state, queueForTtsThenType), `BackgroundMusic`, `/api/answers`, the reflection layout components, the 1-second `CONTINUE_AFTER_TTS_MS` timing.

## Fix 1 — no-flash headline render

The render logic now has three branches. From [`components/Reflection.tsx`](components/Reflection.tsx):

```tsx
const { type, copy, payload } = reflection;
// Three-state render so there's no flash of full text on mount:
// 1. typewriter is ticking → show what the typewriter has revealed so far
// 2. typewriter hasn't started AND > 3 s elapsed → show full copy (slow TTS fallback)
// 3. typewriter hasn't started AND < 3 s elapsed → show non-breaking space (reserves layout)
const headlineText = reflectionTTSDisplayText
  ? reflectionTTSDisplayText
  : showFallbackCopy
    ? copy
    : " ";
```

`showFallbackCopy` is driven by two effects:

```tsx
// Slow-TTS safety net: if the typewriter hasn't started within 3 s, drop
// the empty placeholder and show the full copy. Cancelled the moment any
// displayText arrives (cleared in the effect below).
useEffect(() => {
  fallbackTimerRef.current = setTimeout(
    () => setShowFallbackCopy(true),
    FALLBACK_COPY_DELAY_MS  // 3000
  );
  return () => {
    if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
  };
}, []);

// As soon as TTSPlayer ticks the first character, kill the fallback timer —
// the typewriter is the source of truth from here on.
useEffect(() => {
  if (!reflectionTTSDisplayText) return;
  if (fallbackTimerRef.current) {
    clearTimeout(fallbackTimerRef.current);
    fallbackTimerRef.current = null;
  }
  if (showFallbackCopy) setShowFallbackCopy(false);
}, [reflectionTTSDisplayText, showFallbackCopy]);
```

The non-breaking space (`" "`) preserves the headline's line height so the rest of the layout doesn't shift while we wait for TTS — the content area looks visually still on mount, then the typewriter starts revealing characters, no jump.

The layout components (`ReflectionTribe`, `ReflectionSlider`, `ReflectionDistribution`) didn't need to change — they still use `displayText || copy`, and the new `headlineText` is always non-empty (typewriter text, full copy, or `" "`), so the `||` short-circuit always picks `headlineText` over `copy` when the parent passes it.

## Fix 2 — 500 ms transition buffer

Both stage transitions now defer their state writes through a timer ref, so the outgoing TTSPlayer has time to pause its audio and revoke its blob URL before the next stage's TTSPlayer mounts and starts fetching. From [`app/respond/[formId]/RespondentFlow.tsx`](app/respond/[formId]/RespondentFlow.tsx):

```tsx
function advanceQuestion() {
  playTick();
  if (nullReflectionTimerRef.current) {
    clearTimeout(nullReflectionTimerRef.current);
    nullReflectionTimerRef.current = null;
  }
  // Reflection's TTS is already finished by the time Continue is clickable
  // (Continue is gated on reflectionTTSDone), so no audio is playing right
  // now. The 500 ms buffer below is a visual hold — let framer-motion's
  // exit animation finish and TTSPlayer unmount cleanly before the next
  // stage's TTSPlayer mounts and kicks off its preload-audio playback.
  if (stageTransitionTimerRef.current) {
    clearTimeout(stageTransitionTimerRef.current);
  }
  stageTransitionTimerRef.current = setTimeout(() => {
    stageTransitionTimerRef.current = null;
    setPhrasedForTTS(null);
    setPreloadedAudioUrlForTTS(null);
    setIsSpeaking(false);
    setTtsDisplayText("");
    setTtsDone(false);
    setReflectionData(null);
    setNullReason(null);
    setNullDebugInfo(null);
    pendingReflectionRef.current = null;
    pendingNullReasonRef.current = null;
    pendingNullDebugInfoRef.current = null;
    setAvatarMode("thinking");
    if (questionIndex + 1 < questions.length) {
      setQuestionIndex((i) => i + 1);
      setStage("QUESTION");
    } else {
      setAvatarMode("idle");
      setStage("COMPLETE");
    }
  }, 500);
}
```

```tsx
function goToReflection(
  reflection?: ReflectionResult | null,
  reason?: NullReflectionReason | null,
  debugInfo?: string | null
) {
  if (nullReflectionTimerRef.current) {
    clearTimeout(nullReflectionTimerRef.current);
    nullReflectionTimerRef.current = null;
  }
  const ref = reflection ?? null;
  // Tear the question's TTS down NOW so its audio stops immediately.
  setPhrasedForTTS(null);
  setPreloadedAudioUrlForTTS(null);
  setIsSpeaking(false);
  setTtsDisplayText("");
  setTtsDone(false);
  setFollowUpPrompt(null);
  setAvatarMode("idle");
  if (ref) playWhoosh();
  playTick();
  // 500 ms buffer before flipping to REFLECTION so the question's TTSPlayer
  // unmounts cleanly before the reflection's TTSPlayer fetches new audio.
  if (stageTransitionTimerRef.current) {
    clearTimeout(stageTransitionTimerRef.current);
  }
  stageTransitionTimerRef.current = setTimeout(() => {
    stageTransitionTimerRef.current = null;
    setReflectionData(ref);
    setNullReason(ref ? null : reason ?? null);
    setNullDebugInfo(ref ? null : debugInfo ?? null);
    setStage("REFLECTION");
    if (!ref) {
      nullReflectionTimerRef.current = setTimeout(advanceQuestion, 2000);
    }
  }, 500);
}
```

Two subtle differences between the two:

- `goToReflection` clears the question's TTS state **immediately** (so the question's `<TTSPlayer>` unmounts now and audio stops), then defers only the actual `setStage("REFLECTION")` flip. This is because the question's TTS might still be tail-ending if the user advanced quickly via reaction (theoretical — input is gated on `ttsDone`, but defensive).
- `advanceQuestion` defers everything inside the timer. Reflection's TTS is already idle (Continue is gated on `reflectionTTSDone`), so there's no audio to stop. The deferral is purely for the visual hold + framer-motion exit animation overlap.

Cleanup added to the existing unmount effect:

```tsx
useEffect(() => {
  return () => {
    preloadCacheRef.current.forEach(({ audioUrl }) => {
      URL.revokeObjectURL(audioUrl);
    });
    preloadCacheRef.current.clear();
    if (stageTransitionTimerRef.current) {
      clearTimeout(stageTransitionTimerRef.current);
      stageTransitionTimerRef.current = null;
    }
    if (nullReflectionTimerRef.current) {
      clearTimeout(nullReflectionTimerRef.current);
      nullReflectionTimerRef.current = null;
    }
  };
}, []);
```

The existing `if (stageTransitionTimerRef.current) clearTimeout(...)` calls inside `advanceQuestion`/`goToReflection` ensure user-initiated rapid double-clicks coalesce — the second click clears the first's pending timer and starts a fresh one.

## Fix 3 — reactions are visual only

Removed `REACTION_ADVANCE_MS`, `advanceTimerRef`, and `scheduleReactionAdvance`. `handleReaction` now records the reaction and persists via `/api/reactions` but does not call `advance()`:

```tsx
// Reactions are now expressive only. They register visually + persist via
// /api/reactions, but they do NOT advance the flow. Continue is the only
// way to move on.
function handleReaction(key: string) {
  if (reacted) return;
  setReacted(key);

  if (sessionId) {
    fetch("/api/reactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sessionId,
        question_id: questionId,
        reaction: key,
      }),
    }).catch(() => {});
  }
}
```

The `clearTimers()` helper now only clears `continueTimerRef` and `fallbackTimerRef` (the new safety-net timer). `advanceTimerRef` is gone.

## TTSPlayer cleanup verification (no changes)

Read [`components/TTSPlayer.tsx`](components/TTSPlayer.tsx) lines 166–184 — the existing useEffect cleanup pauses the audio element, nulls the event handlers, sets `audio.src = ""`, and revokes the object URL. So when Reflection unmounts (during the 500 ms transition window), the reflection TTS audio is paused before the next stage's TTSPlayer mounts. No code changes required there.

## Verification

- `npx tsc --noEmit` — passes.
- `npm run build` — passes.
- `npx eslint .` — **18 problems (11 errors, 7 warnings)** — flat from the previous phase. The new `setShowFallbackCopy(false)` setState-in-effect needed `eslint-disable-next-line react-hooks/set-state-in-effect`, same pattern used elsewhere in the file. No new warnings from the cleanup additions.

### Browser verification (limited)

The dev preview's autoplay/user-gesture gate continues to refuse to progress past `handleStart` (same limitation flagged in `docs/tts-fix-report.md` and `docs/reflection-tts-report.md`). Programmatic clicks via `preview_click` register on the `Let's start →` button but `setStarting` doesn't commit, no `/api/sessions` call fires, and the flow can't reach a question — let alone a reflection. None of the standard escape hatches help in this environment.

What I verified by reading the new code:

- **Headline placeholder is always non-empty** so the `displayText || copy` short-circuit in the layout components keeps using `displayText` when the parent passes it. Whether the typewriter has started, the fallback has fired, or we're still in the < 3 s window, `headlineText` is one of: typewriter text, full copy, or `" "`.
- **No flash on mount.** Initial render: `reflectionTTSDisplayText = ""`, `showFallbackCopy = false` → `headlineText = " "`. The H1/H2 reserves its line height (browsers respect non-breaking spaces in styled text). The headline is invisible but takes up the same visual space — no shift when the typewriter starts.
- **Slow-TTS fallback fires correctly.** The 3 s `setTimeout` runs only on initial mount (deps `[]`). Once `reflectionTTSDisplayText` becomes non-empty (a single character is enough), the second effect kills the fallback timer and clears `showFallbackCopy` if it had already been set. Idempotent — re-mounts of the Reflection component (different reflection) get a fresh timer.
- **Stage transition buffer.** Both `advanceQuestion` and `goToReflection` defer their `setStage(...)` call by exactly 500 ms via a single shared `stageTransitionTimerRef`. Re-firing either function (which shouldn't happen with the gated UI, but defensive) clears the previous timer first, so the most recent caller wins.
- **Audio collision impossible by construction.** When `advanceQuestion` fires, reflection TTS is already done (Continue gated on `reflectionTTSDone`). The `setReflectionData(null)` + `setStage("QUESTION")` happen 500 ms later in a single batch. The Reflection component unmounts → its TTSPlayer cleanup pauses the audio element (no-op since audio already finished). Then the question stage's QuestionStage mounts and starts. Question TTS only plays after this point.
- **Reactions don't advance.** `handleReaction` no longer calls `setTimeout(advance, ...)`. The only paths to `advance()` are: `handleContinue` (Continue button click), `handleCardClick` (clicking the card area, gated on `showContinue`), `handleCardKeyDown` (Enter/Space, gated on `showContinue`). All three require Continue to be shown, which requires `reflectionTTSDone + 1 s`.
- **Cleanup correctness.** The unmount effect now clears both `stageTransitionTimerRef` (Phase 6.5c) and `nullReflectionTimerRef` (existing). If the user navigates away mid-transition, no orphan timers fire later.

## Items wanting human review

1. **Continue-click visual feedback during the 500 ms buffer.** Right now: user clicks Continue → `playTick` plays → 500 ms of nothing visible → reflection unmounts (300 ms framer-motion exit) → next stage mounts. Total click-to-next-stage feels like ~800 ms. Audio cue (`playTick`) covers the perceptual gap, but the button itself doesn't change. If user testing reveals it feels broken, the cheapest improvement is to fade the Continue button on click (set a local "leaving" state in Reflection and animate opacity to 0). Out of scope here.

2. **3 s fallback is generous.** Sarvam Bulbul TTS typically resolves in ~1–3 s. If it consistently lands closer to 1 s, the 3 s fallback is dead weight. If it consistently lands closer to 4 s, the fallback fires before audio starts, which is exactly the case it was designed for. Worth measuring once we have real-respondent data — drop to 2 s if median TTS is < 1 s.

3. **Stage transition buffer is uniform 500 ms.** A user clicking Continue to move from Reflection → Question now waits 500 ms with no visual change. If we wanted snappier-feeling transitions for some paths, we could use a shorter value for `goToReflection` (since the user just submitted an answer; they're expecting a delay) and a longer one for `advanceQuestion` (since the user just hit Continue; they want the next question now). Spec said apply uniformly, so I did.

4. **No skip-during-TTS.** A power user can't speed through reflections by pressing Continue mid-TTS. The button isn't shown until after `reflectionTTSDone + 1 s`. Spec accepted this as the price of the new UX shape; flagging in case it surfaces in user testing.

5. **`reactionPops` realtime channel still fires.** The live overlay (used by EntryScreen) listens for reactions across all sessions. Since reactions still POST to `/api/reactions`, those pops still appear on the entry screen for other respondents — which is the intended visible-to-all-users behaviour. No change needed; flagging because someone reading "reactions don't advance" might assume they got disabled entirely.

6. **Reaction → no advance is a UX bet.** The product theory is reactions should be expressive ("I felt that") not navigational ("done with this card"). Some users will click a reaction and expect to advance. Hackathon-acceptable; revisit after watching real users.

7. **Headless E2E remains blocked.** Same limitation as 6.5a/6.5b. Real browser harness or test seam in `handleStart` would be needed to automate the reflection-lifecycle test. Flagging once more.

8. **The ` ` placeholder is invisible but selectable.** A user using screen-reader or text-select would briefly see/hear a non-breaking space. Aria-friendly alternative: render with `aria-hidden` until typewriter starts, or use `visibility: hidden` on the H1 with the full copy inside (so the layout is reserved correctly and screen readers don't read the placeholder). The current minimal-diff approach is acceptable for a hackathon scope; flagging for accessibility review.
