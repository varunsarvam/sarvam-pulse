# TTS / Typewriter / Phrase-Question Fix Report

## Files modified

- `app/respond/[formId]/RespondentFlow.tsx` — only file touched.

## Diff summary

```
1 file changed, 59 insertions(+), 143 deletions(-)
```

Net **−84 lines**. The QuestionStage main effect went from a 165-line phrase-fetch + SSE + cache + AbortController + retry-fallback block to a 35-line "reset state and queue if phrasing is already known" block. A new 7-line watcher effect was added that fires `queueForTtsThenType` when the parent's preload arrives after mount.

## What changed (per fix)

### Fix 1 — TTSPlayer key

[`RespondentFlow.tsx:1521`](app/respond/[formId]/RespondentFlow.tsx:1521)

```diff
- key={`tts-${stage}-${questionIndex}-${phrasedForTTS}`}
+ key={`tts-${stage}-${questionIndex}`}
```

`phrasedForTTS` removed from the key. Re-writes of `phrasedForTTS` (including the same value, or a slightly-differently-whitespaced LLM result) no longer remount TTSPlayer mid-playback. TTSPlayer's internal effect already re-runs on `[text, tone, preloadedAudioUrl]` change, so prop updates land cleanly without a unmount/remount cycle.

### Fix 2 — QuestionStage no longer fetches `/api/phrase-question`

`queueForTtsThenType` was hoisted from inside the main effect to component scope so both effects can call it.

The main effect (`[question.id]`):
- Resets local typewriter state and clears timers (unchanged behaviour).
- For `name` question → synchronous `queueForTtsThenType(NAME_QUESTION_PROMPT)`.
- For non-name with `preloaded` already populated → synchronous `queueForTtsThenType(preloaded.phrased, preloaded.audioUrl)`.
- For follow-ups (`question.position === -1`) → synchronous `queueForTtsThenType(question.prompt)` since the follow-up endpoint already returns tone-aware text.
- Otherwise → does nothing (the watcher below will fire when `preloaded` lands).
- Cleanup just clears timers — no AbortController, no `cancelled` flag, no `controller.abort()`.

A new watcher effect (`[preloaded?.phrased, preloaded?.audioUrl, question.id]`) fires `queueForTtsThenType(preloaded.phrased, preloaded.audioUrl)` if and only if `preloaded` is non-null AND `pendingTypewriterText` hasn't already been set (idempotency guard).

Removed:
- The 6 s `setTimeout(() => controller.abort(), 6000)` timeout
- The `AbortController` and `cancelled` flag
- The sessionStorage phrase cache (was only populated by the SSE branch, which is now gone)
- The SSE stream reader (decoder, buffer, line parser, `parsed.chunk`/`parsed.done`/`parsed.error` branches)
- The `.catch` fallback that called `queueForTtsThenType(question.prompt)` after a timeout — without a fetch there's no error to handle
- The `ttsTriggered` local that gated the catch fallbacks

### Fix 3 — `firstCharRef`

[`RespondentFlow.tsx:478`](app/respond/[formId]/RespondentFlow.tsx:478) — removed. Was assigned `false` at the top of the main effect but never read anywhere. Dead code from an earlier streaming-typewriter approach.

### Bonus cleanup (caused by Fix 2)

Four QuestionStage props (`sessionId`, `tone`, `formIntent`, `respondentName`) became unused inside the component once the fetch went away. Rather than change the call-site contract (parent still passes them), they're now marked with `void` at the top of the function — the same pattern the codebase already uses elsewhere (e.g. `void question;` in EmojiSlider). This silences the lint warnings without breaking any callers.

## Verification

### Build / type / lint

- `npx tsc --noEmit` — passes.
- `npm run build` — passes; route table unchanged.
- `npx eslint .` — **18 problems (11 errors, 7 warnings)**. Comparison to pre-fix:
  - Errors: 11 → 11 (unchanged). The new watcher effect's `queueForTtsThenType` call is the same `setState-in-effect` pattern as the existing main-effect call; suppressed with `eslint-disable-next-line react-hooks/set-state-in-effect`. Net error count is flat.
  - Warnings: 6 → 7 (+1). The +1 is `'Link' is defined but never used` in `app/page.tsx`, which is a pre-existing warning that I evidently missed in the Phase 6 baseline count — unrelated to this phase. The 4 newly-unused props are silenced via `void`.
  - `firstCharRef` removal didn't reduce the lint count because the lint rule was reading `ref.current = false` as a write (counts as use).

### Manual test (headless preview limitation)

I tried to walk through the test sequence in the headless dev preview. **The browser's autoplay/user-gesture gating refused to progress past `handleStart` in this environment** — programmatic clicks (both `.click()` and `dispatchEvent(new PointerEvent(...))`) and the preview tool's `preview_click` all visibly clicked the button (`Successfully clicked: ...`) but `setStarting(true)` never committed, the entry screen stayed mounted, and no `/api/phrase-question` or `/api/tts` requests fired.

I tried the standard headless escape hatches:
- Override `navigator.mediaDevices.getUserMedia` to throw immediately (skips the mic prompt) — no effect on the gating.
- Override `AudioContext.prototype.resume` to no-op — no effect.
- Reload + re-install fetch interceptor + click — no effect.

The button's `__reactProps$*` keys came back empty in the eval, suggesting the headless React internals don't expose the synthetic event handlers in the same shape the inspector usually sees. I didn't pursue this further — the issue is environmental, not a code bug introduced by this fix.

What I did verify (read-only, server-side):
- `npm run build` and `npx tsc --noEmit` both pass.
- The fix removes the only place QuestionStage called `/api/phrase-question` (a project-wide grep for that path now finds two callers: `preloadQuestion` in the parent, and a sessionStorage cache hit case which I deleted alongside the SSE branch).
- The TTSPlayer key change is local and structural; TTSPlayer's internal effect already handles `text` prop changes correctly (re-runs the load + play on every `text` change, with proper cleanup of the previous audio element).

### Network/audio/typewriter behaviour by code review

Walking through what each question's lifecycle looks like now:

| Question | Phrase requests | TTS requests | Trigger |
|---|---|---|---|
| Q1 = name (non-anonymous) | 0 | 1 (TTSPlayer fetches itself; no preload audio for name) | Main effect's `name` branch fires `queueForTtsThenType(NAME_QUESTION_PROMPT)` synchronously. No race. |
| Q1 = real (anonymous) | 1 (parent `preloadQuestion`, json mode) | 1 (parent `preloadQuestion`'s TTS step) | If preload finishes before QuestionStage mounts, main effect's `else if (preloaded)` branch fires immediately. Otherwise watcher fires when preload lands. Either way, single source of truth, single phrase fetch, no SSE. |
| Q2…Qn (after name) | 1 (parent preload) | 1 (parent preload) | Same as anonymous Q1. |
| Follow-up | 0 (no phrase rephrasing — uses follow-up endpoint output directly) | 1 (TTSPlayer fetches its own audio) | Main effect's `position === -1` branch fires `queueForTtsThenType(question.prompt)` synchronously. |

Net per question: **1 phrase-question + 1 tts** (or **0 + 1** for name / follow-up). No duplicates. No aborts. The `(canceled) + (pending)` pair the user reported is gone — there's no QuestionStage controller to abort, and Strict Mode's double-invoke now only re-fires `queueForTtsThenType` (which the parent's `if (phrasedForTTS) return;` guard absorbs as a no-op same-value setState).

### Question text now LLM-rephrased, not raw

The 6 s timeout that frequently aborted the QuestionStage SSE fetch (Sarvam's 7-10 s typical response time exceeds it) is gone, because the SSE fetch is gone. The parent's `preloadQuestion` has no client-side timeout — it waits as long as the network does. So the displayed text is now always the parent's preloaded phrasing (LLM-rephrased), not the raw prompt fallback.

## Anything surprising

1. **Removing `firstCharRef` didn't drop the lint count.** The variable was clearly dead, but ESLint's "unused-vars" rule treats `ref.current = false` as a use. Effectively a benign no-op.
2. **The watcher effect needs an explicit `eslint-disable react-hooks/set-state-in-effect`** at the `queueForTtsThenType` call. The harness's react-hooks rule flags any `setState`-equivalent inside an effect body. The existing main effect already had the same suppression — so this isn't a new pattern, just an additional instance of an established one.
3. **`sessionStorage` cache went away with the SSE branch.** No other code path was writing to it, so removing the read is safe — but if anyone was relying on its presence as a debugging signal ("ah, this question was rephrased successfully because there's an entry"), that signal is gone now. Worth flagging for future debug workflows.
4. **`preloadCacheRef` is now the only authoritative phrasing cache.** Across navigations within the same session the cache persists in memory; a page reload clears it (and the parent's preload re-runs). No persistent storage of phrasing — same as before, just made cleaner.
5. **Headless E2E gating is a real obstacle** for this kind of audio-flow test. If we want repeatable automated verification of the respondent flow in the future, we'll need either a real browser harness (Playwright with a real Chromium and `--allow-file-access-from-files --autoplay-policy=no-user-gesture-required`) or test seams that bypass `handleStart`'s gating in test mode.
6. **The QuestionStage props are now half-ignored.** The component still accepts `sessionId`, `tone`, `formIntent`, `respondentName` because the parent passes them and the type contract expects them. They're explicitly marked `void` to silence lint. If you wanted to clean up the prop API, removing those four would be a follow-up — but it changes the call site signature, which the spec said not to refactor in this phase.
7. **`/api/phrase-question`'s SSE branch is now genuinely orphaned.** No client calls it (parent uses `response_mode: "json"`, QuestionStage no longer calls at all). The route still serves it — could be deleted in a post-rebuild cleanup pass.
