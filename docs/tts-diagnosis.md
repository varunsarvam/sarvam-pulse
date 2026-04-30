# TTS / Typewriter / Phrase-Question Failure — Diagnosis

**Scope:** read-only investigation. No code changes.

## Symptom recap

1. TTS audio never plays — no `/api/tts` requests in Network tab.
2. Typewriter never runs — text appears statically or not at all.
3. Phrase-question shows one `(canceled)` + one `(pending)` for the same question.
4. Reflections fail on first answer, work on subsequent ones.

---

## 1. Effect dependency analysis

There are **five** interacting effects across `RespondentFlow.tsx`. All five are gating a single delicate dance: get the phrased text → start TTS → run typewriter → reveal inputs.

### A. QuestionStage main effect — fires `/api/phrase-question`
[`app/respond/[formId]/RespondentFlow.tsx:546`](app/respond/[formId]/RespondentFlow.tsx:546)

```ts
useEffect(() => {
  // Reset state, build AbortController, 6s timeout, possibly fetch /api/phrase-question
  ...
  return () => { controller.abort(); ... };
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [question.id]);
```

| Real dep | Listed? | Stable? | Notes |
|---|---|---|---|
| `question.id` | ✅ | ✅ | string, only changes on advance |
| `preloaded` | ❌ (suppressed) | ❌ — prop | parent rewrites this when preload lands |
| `respondentName` | ❌ (suppressed) | ❌ — flips null → "Varun" after Q1 | captured stale |
| `tone` | ❌ (suppressed) | ✅ | form.tone is constant |
| `formIntent` | ❌ (suppressed) | ✅ | form.intent is constant |
| `sessionId` | ❌ (suppressed) | ⚠️ — flips null → id once | captured stale on first mount if effect ran with null |

**The effect is intentionally gated only on `question.id`** — it lifts the eslint rule so it only re-runs when the question changes. That is correct for what it intends. But it means changes to `preloaded` (which lands later) never propagate into the effect.

### B. Parent preload effect — fires `preloadAll`
[`RespondentFlow.tsx:1180`](app/respond/[formId]/RespondentFlow.tsx:1180)

```ts
useEffect(() => {
  if (stage !== "QUESTION" || !sessionId || questionIndex !== 0) return;
  void preloadAll(sessionId, null);
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [stage, sessionId, questionIndex]);
```

Stable. Internal `preloadStartedRef` guard prevents double-runs even under Strict Mode.

### C. Parent preload-cache → state sync
[`RespondentFlow.tsx:1169`](app/respond/[formId]/RespondentFlow.tsx:1169)

```ts
useEffect(() => {
  const q = questions[questionIndex];
  if (!q) { setPreloadedForCurrent(null); return; }
  setPreloadedForCurrent(preloadCacheRef.current.get(q.id) ?? null);
}, [questionIndex, preloadProgress, questions]);
```

Fires every time `preloadProgress` ticks (which it does twice per question: phrase done + TTS done) AND every time `questionIndex` changes. **Effect runs AFTER QuestionStage has already mounted** for the new questionIndex — so QuestionStage gets `preloaded={null}` on mount even when the cache already has the entry, and the prop only updates on the next render.

### D. Parent preload-landed → set TTS state
[`RespondentFlow.tsx:1191`](app/respond/[formId]/RespondentFlow.tsx:1191)

```ts
useEffect(() => {
  if (stage !== "QUESTION" || !preloadedForCurrent) return;
  if (phrasedForTTS) return;
  setPhrasedForTTS(preloadedForCurrent.phrased);
  setPreloadedAudioUrlForTTS(preloadedForCurrent.audioUrl);
}, [stage, preloadedForCurrent, phrasedForTTS]);
```

Stable, but races C: when `preloadedForCurrent` flips from null to non-null, this effect commits `phrasedForTTS = preloaded.phrased`. **It does not block the QuestionStage's own fetch from also setting `phrasedForTTS` later.**

### E. QuestionStage typewriter sync
[`RespondentFlow.tsx:488`](app/respond/[formId]/RespondentFlow.tsx:488)

```ts
useEffect(() => {
  if (!pendingTypewriterText) return;
  if (ttsDisplayText) {
    ...
    setPhrased(ttsDisplayText);  // ← runs every TTS tick (28 ms)
    setThinking(false);
  }
  if (ttsDone) {
    setPhrased(pendingTypewriterText);
    ...
    revealInputs(INPUT_REVEAL_DELAY_MS);
  }
}, [pendingTypewriterText, ttsDisplayText, ttsDone]);
```

`ttsDisplayText` ticks every 28 ms during playback → this effect fires hundreds of times per question, each call writes `setPhrased(...)` which causes another re-render. Not a correctness bug per se, but a churn machine.

---

## 2. Lifecycle trace (Q1, anonymous mode — non-name first question)

| # | Step | Status |
|---|---|---|
| 1 | User clicks "Let's start" → `handleStart` runs, awaits mic perm, fetches `/api/sessions`, calls `setSessionId(id)` then `setStage("QUESTION")` | ✅ |
| 2 | Render with `stage="QUESTION"`, `sessionId=id`, `questionIndex=0`. Parent's preload effect fires `preloadAll(sessionId, null)`. | ✅ |
| 3 | `preloadAll` → `preloadQuestion(Q1, …)` for every non-name question, in parallel | ✅ |
| 4 | `<QuestionStage>` mounts with `preloaded={null}` (parent sync effect hasn't run yet) | ✅ |
| 5 | QuestionStage main effect runs. `preloaded=null`. Q1 is not "name". Falls through to **its own** SSE fetch of `/api/phrase-question`. | ⚠️ — **second fetch for the same question** |
| 6 | **React Strict Mode (dev)** runs the effect a second time: cleanup → `controller#1.abort()` → mount#2 → fires fetch#2. | ⚠️ — produces the `(canceled)` + `(pending)` pair the user sees |
| 7 | Parent's `preloadQuestion(Q1)` resolves: writes to `preloadCacheRef`, bumps `preloadProgress`. Sync effect (C) fires → `setPreloadedForCurrent(entry)`. | ✅ |
| 8 | Preload-landed effect (D) fires → `setPhrasedForTTS(entry.phrased)`, `setPreloadedAudioUrlForTTS(entry.audioUrl)` | ✅ |
| 9 | TTSPlayer mounts with **preloaded blob URL** → skips `/api/tts`, plays the cached blob | ✅ — **explains "no /api/tts in Network tab"**: when preload lands first, TTSPlayer never fetches /api/tts itself |
| 10 | Audio.play() starts → `onDisplayedTextChange` ticks every 28 ms → parent's `ttsDisplayText` updates → typewriter effect (E) fires → `setPhrased(ttsDisplayText)` per tick | ✅ |
| 11 | **Meanwhile** QuestionStage's SSE fetch#2 finishes → calls `queueForTtsThenType(parsed.phrased, undefined)` → parent's `handlePhrasedReady(parsed.phrased, undefined)` → `setPhrasedForTTS(parsed.phrased)`, `setPreloadedAudioUrlForTTS(null)` | ❌ — **stomps the in-flight playback** |
| 12 | TTSPlayer's `key` includes `phrasedForTTS`. The text from SSE is rarely byte-identical to preload's text (different LLM run / whitespace) → key changes → **TTSPlayer unmounts** mid-playback. Cleanup pauses the audio, revokes the object URL. | ❌ — explains "TTS audio never plays": you hear at most a partial second before it's killed |
| 13 | New TTSPlayer mounts with `preloadedAudioUrl=null` → fetches `/api/tts` → but by then the user has either clicked away or the typewriter effect has already chewed up renders | ⚠️ — `/api/tts` *should* now appear in Network, but late and tied to the second instance |
| 14 | Typewriter never finishes because each TTSPlayer remount calls `onDisplayedTextChange("", false)` first, resetting `ttsDisplayText` → the typewriter effect's `setPhrased(ttsDisplayText)` writes empty string → static text on screen | ❌ |

For **Q1 = name question** (non-anonymous mode): step 5 doesn't fire SSE — the name shortcut at line 588 calls `queueForTtsThenType(NAME_QUESTION_PROMPT)` synchronously inside the effect. No race with preload (Q1 name is filtered out of preload). Works cleanly. **This is why Q1 looks fine but Q2+ break — Q1 is the name question and bypasses the buggy path.**

For Q2+ (after name): same race as steps 5–14, except now `respondentName="Varun"` is captured in the closure correctly (effect re-ran on questionIndex change → new closure).

---

## 3. Suspected root cause

Three converging issues, ordered by impact:

### Primary — TTSPlayer key thrashes on every `phrasedForTTS` write
[`RespondentFlow.tsx:1513`](app/respond/[formId]/RespondentFlow.tsx:1513)

```ts
key={`tts-${stage}-${questionIndex}-${phrasedForTTS}`}
```

Two writers race to set `phrasedForTTS`: parent preload (D, with audio URL) and QuestionStage's own SSE fetch (via `queueForTtsThenType` → `onPhrasedReadyRef.current`, with no audio URL). When the SSE result lands second, it overwrites the preload's phrasing — even when the strings are nearly identical, any whitespace/casing diff makes the key change → TTSPlayer unmounts mid-playback → audio is killed. Visible Network effect: at most one short `/api/tts` request, often none if the preload blob was used.

### Secondary — QuestionStage runs its own phrase-question fetch even when preload is on the way
[`RespondentFlow.tsx:546`](app/respond/[formId]/RespondentFlow.tsx:546)

The effect's `[question.id]` deps mean `preloaded` is read once at mount. On Q2+ mount, the parent's sync effect (C) hasn't run yet, so `preloaded` is still null — QuestionStage falls through to fire its own SSE fetch. The preload typically lands first, so the SSE fetch is wasted bandwidth AND becomes the second-writer that breaks the TTSPlayer (issue 1). Removing this redundant fetch makes the race vanish.

### Tertiary — Strict Mode double-invoke produces the visible "canceled + pending"
[`RespondentFlow.tsx:701`](app/respond/[formId]/RespondentFlow.tsx:701)

```ts
return () => {
  cancelled = true;
  controller.abort();
  ...
};
```

In React 18 dev (Strict Mode), the effect runs → cleanup runs → effect runs again. The first run starts the SSE fetch; the cleanup aborts it. The user sees one canceled fetch and one pending fetch in DevTools. **This is expected Strict-Mode behaviour and not the cause of the user-visible breakage** — it just makes Network look noisy. Production behaviour is single-fetch (no abort/retry). The real bug is the secondary issue above.

---

## 4. What I'd change (no code edits made)

The cleanest, smallest-diff fix in priority order:

1. **Stabilise the TTSPlayer key** so it doesn't depend on the text content. Replace with a per-question/stage identifier:

   ```tsx
   key={`tts-${stage}-${questionIndex}`}
   ```

   Now writes that re-set `phrasedForTTS` to similar text don't remount TTSPlayer. The `text` prop change is fine — TTSPlayer's effect already keys on `[text, tone, preloadedAudioUrl]` and will re-run cleanly.

2. **Make QuestionStage skip its own phrase fetch when preload exists.** Two options:
   - (Preferred) Remove the QuestionStage SSE fetch entirely. The parent's `preloadAll` already covers every non-name question including anonymous Q1. Make QuestionStage wait on `preloaded` (passed via prop) and `pendingTypewriterText` driven by parent. Single source of truth.
   - (Smaller diff) Add a check at the top of the effect: `if (preloaded || preloadCacheRef.current.has(question.id)) { queueForTtsThenType(...); return; }` — but the parent's cache ref isn't accessible from QuestionStage. Would need to pass a peek function or expose `preloadCacheRef`. Uglier than option (a).

3. **Drop `setPhrased(ttsDisplayText)` per-tick from the typewriter effect.** Either move the displayed text rendering directly to read `ttsDisplayText` from props, or debounce. Hundreds of state writes per second is enough to cause dropped frames on slow devices.

4. **Move `setPendingTypewriterText(null)` out of the effect body** (line 565). It runs every effect re-invocation and races against the synchronous `queueForTtsThenType(...)` call further down. Strict Mode amplifies this. Cleaner: only reset on cleanup.

After (1) and (2): the TTSPlayer thrashing goes away; QuestionStage no longer fires its own fetch; the only `/api/phrase-question` call per question is from the parent's preload (json mode). `/api/tts` is called once per question by `preloadQuestion`. Typewriter syncs cleanly off the parent's `ttsDisplayText`. No race.

---

## 5. Anything else surprising

- **`firstCharRef` is declared but never read** ([line 479](app/respond/[formId]/RespondentFlow.tsx:479)). Dead code from an earlier streaming-typewriter approach.
- **`queueForTtsThenType` with no audio URL clobbers a preloaded URL.** [Line 567-574](app/respond/[formId]/RespondentFlow.tsx:567): `onPhrasedReadyRef.current(text, audioUrl)` — caller passes `undefined` from the SSE `done` event (line 673). Parent's `handlePhrasedReady` then writes `setPreloadedAudioUrlForTTS(audioUrl ?? null)` → null. So a successful preload's audio URL gets overwritten with null on the SSE fetch's late landing. This is the mechanism behind the Primary issue.
- **`preloadAll` uses `null` as activeName** ([line 1182](app/respond/[formId]/RespondentFlow.tsx:1182)) — fires on Q1 mount, before the user has typed their name. Phrasings are pre-generated as if the form were anonymous, then served on Q2 onwards where the user's name *should* personalise them. Mild content quality issue, separate from the TTS bug. Worth flagging if "personalised phrasing" is a feature.
- **`/api/phrase-question` SSE branch never actually streams to the typewriter.** [Lines 666-668](app/respond/[formId]/RespondentFlow.tsx:666): the `parsed.chunk` branch has only a comment and no code. The endpoint advertises SSE but the client only acts on the final `done` event. Either the endpoint should drop SSE in favour of JSON, or the client should actually consume `chunk` events. Currently, sending SSE is wasted server work.
- **6 s timeout on QuestionStage's fetch** ([line 550](app/respond/[formId]/RespondentFlow.tsx:550)). The phrase-question route hits Sarvam-105B; per Phase 2 measurements that's ~7-10 s. So this fetch routinely *aborts on timeout*, fires the `.catch` block, and `queueForTtsThenType(question.prompt)` runs with the raw prompt instead of the LLM-rephrased version. **The phrasing the user sees is probably the raw prompt 50%+ of the time.** Worth raising independently of the TTS bug.
- **`stage_b_failed` / `stage_c_failed` flags** in `/api/forms/generate` response — leftover from Phase 3 — would suggest tests for the partial-success paths haven't been exercised since Phase 3 verification. No bug, just a "are we still using these?" question.
- **Parent's avatar-mode effect** ([line 1215](app/respond/[formId]/RespondentFlow.tsx:1215)) calls `setAvatarMode` from inside the effect body, which the harness lints as `react-hooks/set-state-in-effect`. Pre-existing. Unrelated to TTS but visible in the lint pass.
- **`AnimatePresence mode="wait"`** wraps the QUESTION/FOLLOWUP/REFLECTION/COMPLETE panels ([line 1542](app/respond/[formId]/RespondentFlow.tsx:1542)). On stage transitions framer-motion holds the outgoing element in the DOM until its exit animation finishes (300 ms). During that window QuestionStage is technically still mounted with the old `questionIndex`, but the `key` for the new motion.div doesn't enter yet. This delays the new QuestionStage mount by ~300 ms — minor but worth knowing if anyone investigates the timing of the parent preload sync vs. QuestionStage mount.
