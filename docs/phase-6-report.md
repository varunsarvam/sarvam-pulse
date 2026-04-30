# Phase 6 Report — Form Creation UI

## Files

**Modified**

- `app/create/page.tsx` — full rewrite. Old shadcn-driven prompt+options builder is gone; new page collects intent + tone + per-question intents + input types + anonymous toggle and POSTs to `/api/forms/generate`. Pulse aesthetic (blue background, Seasons Mix serif headings, Matter body, white cards, dark filled CTA). Includes inline validation, the full-screen loading takeover, and three-tier server-error handling (400 / 502 / generic).
- `components/CompleteStage.tsx` — replaced the Phase 5 plain-text error message with a designed dark identity-card-shaped error state. Added a "Try again" button that re-calls `/api/complete-session` (the same idempotent endpoint). After 2 retry attempts the button disappears and the copy shifts to "Still no luck. … Come back in a bit." No fallback identity is ever shown.
- `app/respond/[formId]/RespondentFlow.tsx` — the two drive-by fixes:
  - `ReactionPopEmoji` now uses `useState(() => …)` for one-time random position instead of `useRef` + reading `.current` during render.
  - Hidden left-panel block (which was `display: none` but still computing framer-motion keyframes) collapsed to an empty `<div className="hidden" />` placeholder. The unused `AIPresence` import, `TONE_BG` constant, and `leftBg` variable that only existed to feed the hidden panel were removed.
- `components/inputs/VisualSelect.tsx` — `<img>` now has an `onError` handler. Placeholder URLs (`https://placeholder.test/...`, `https://placeholder.com/...`) are detected up front and the image element isn't rendered at all. Cards fall back to a soft tint card cycled across 6 colours by index. Label is always shown — image is decoration; label is content.

**Untouched** — all schema files, all `lib/*-generation.ts` files, `lib/aggregation.ts`, `lib/identity.ts`, `lib/reflection.ts`, the `/api/forms` legacy endpoint (orphan but kept for potential script consumers), `/api/forms/generate` route logic, all other input components, `scripts/seed.ts`.

## Loading-state copy (final)

Five-stage rotation, swapped via a 500 ms `setInterval` against elapsed-seconds:

| Elapsed | Copy |
|---|---|
| 0–11 s | Composing your questions in your tone… |
| 12–25 s | Imagining ten different people answering… |
| 26–39 s | Listening to how they'd respond… |
| 40–51 s | Finding the patterns that make reflections meaningful… |
| 52 s+ | Almost ready… |

These map (roughly) to Stages A → B+C → C tail → D+E → finalisation, but the timing is loose — the stages are cosmetic, the pipeline isn't actually reporting back. Sub-headline below stays static: "This takes about a minute. Don't close the tab."

A single white dot pulses (scale 1 → 1.35 → 1, opacity 0.7 → 1, 2.4 s ease-in-out). A radial-gradient veil also slow-pulses behind the headline. No spinner, no percentage. The whole overlay sits over the form — if generation fails, the user is bounced back to a still-populated form via the error banner; their typing is preserved.

## /create page layout

Reading top to bottom on a desktop browser at the verified blue background:

1. **Header.** Serif display headline "Create a Pulse form" (~46 px) and a 3-line subhead in 65%-white Matter explaining what's about to happen ("…simulate ten people answering, and surface the patterns that make reflections feel alive.").
2. **Meta card** — single white rounded-2xl card with subtle drop shadow:
   - Title text input.
   - Intent textarea (3 rows). Helper line below: "1–3 sentences. Beyond the headline — what would you actually want a respondent to say?"
   - Tone — four pill buttons (Playful / Calm / Direct / Insightful), active pill is dark-filled. Helper underneath shows the description ("evocative, thoughtful" for Insightful).
   - Anonymous toggle — full-width checkbox card with subtitle "Hide respondent names. Skip the name question entirely." Default OFF.
3. **Questions** section — display-serif H2 + a small "N questions" counter aligned right. Each question is a white card showing its number ("QUESTION 1"), an intent textarea, and a select dropdown for input type with a hint line below ("1–3 sentences spoken" for Voice).
4. **Add question** — dashed-bordered ghost button with `+` icon.
5. **Server error banner** (conditional) — semi-translucent red panel with the error message; for 502 errors it includes a "Try again" pill button that re-runs `handleSubmit`.
6. **Generate form →** — dark filled pill button (matches the "Begin the conversation →" button on the respondent flow), bottom-right.

The screenshot confirms the layout matches the rest of Pulse's design language — same blue background as `/respond/[formId]`, same Seasons Mix serif, same `#111820` dark CTA.

## Drive-by fixes applied

### 4a. `INPUT_TYPE_LABELS` — `name` decision

**Decision: removed `name` from creator-facing input types entirely.** The new page defines a local `CreatorInputType` (`voice | text | emoji_slider | cards | ranking | this_or_that | visual_select`) so the dropdown literally cannot include `"name"`. The form-generation pipeline still auto-inserts the name question server-side based on the `anonymous` flag — the UI doesn't need to know about it. Verified at runtime: `Array.from(document.querySelector('select').options)` returned exactly 7 items; `name` not present.

### 4b. `ReactionPopEmoji` — `app/respond/[formId]/RespondentFlow.tsx:89`

Before: `useRef({ left: …Math.random(), … })` and `style={{ left: pos.current.left }}` (reads ref during render — anti-pattern).
After: `useState(() => ({ left, top, drift }))` — random call runs once on mount, never on subsequent renders, and never during render of children. `style` reads from state (`pos.left`, `pos.top`) which is render-safe. Animation behaviour unchanged: pop scales 0 → 1.4 → 0 over 1.2 s with horizontal drift, then unmounts.

### 4c. Hidden left-panel framer-motion — `RespondentFlow.tsx`

Before: a `<div className="hidden">` containing a `<motion.div animate={{ opacity: [0.4, 0.75, 0.4] }} transition={{ duration: 9, repeat: Infinity }}>` and an inline `AIPresence` render. The panel was hidden but framer-motion was still computing keyframes.
After: collapsed to an empty `<div className="hidden" />` marker comment ("Previously rendered an AIPresence avatar + a slow-breathing motion tint…"). Removed the now-dead `AIPresence` import, `TONE_BG` constant, and `leftBg` variable that only fed the hidden panel. Lint count drops accordingly.

### 4d. VisualSelect placeholder fallback — `components/inputs/VisualSelect.tsx`

Before: `<img>` always rendered if `image_url` was non-empty; broken URLs would show the browser's default broken-image icon.
After: factored each card into a `VisualOptionCard` sub-component with its own `imgFailed` state. URL is checked up front against `placeholder.test` / `placeholder.com` — if matched, the `<img>` is never mounted (no failed fetch). Otherwise, an `onError` handler flips `imgFailed=true` and the next render hides the image. In both fallback paths the card shows a soft linear-gradient tint (cycled across 6 hues by option index). The label below is always rendered. Selection checkmark overlay still works in both states.

## Validation rules tested

Empty form submission triggered all three inline errors:

```
Give your form a title.
Tell us a bit more — at least 10 characters.
At least 10 characters — what do you want to know?
```

Specific bounds:

| Field | Min | Max | Tested |
|---|---|---|---|
| Title | 1 | 100 | ✓ empty rejected |
| Intent | 10 | 300 | ✓ "" rejected |
| Question intent | 10 | 200 | ✓ "" rejected |
| Questions count | 1 | (no max) | tested via remove button — single question can't be removed (button hidden) |

When the user fixes a field and types more than the minimum, the error clears on next submit attempt (validation re-runs). Form-data is preserved across all error states — typing is never lost.

## Manual test results

Server: `next dev` on `:3000` (existing preview).

1. **Visit `/create`.** ✓ Blue background, serif header, white card with title/intent/tone/anonymous, 1 default question card with Voice selected, Add-question + Generate-form buttons. Console clean (no errors / no warnings).
2. **Dropdown audit.** ✓ 7 options: voice, text, emoji_slider, cards, ranking, this_or_that, visual_select. Verified via `document.querySelector('select').options`. `name` not present.
3. **Validation.** ✓ Submitting empty form surfaces 3 inline errors as above. Filling each field clears the error on resubmit.
4. **Submit with valid form.** Filled title="Phase 6 verify", intent="Understanding how people feel about AI in 2026.", question intent="How they feel about AI in their day", input_type=Voice. Clicked Generate.
   - **Loading overlay rendered.** ✓ Within 800 ms the full-screen takeover appeared with "Composing your questions in your tone…" and the soft pulsing dot. Form preserved underneath. Background image continuous with the rest of Pulse.
   - I did not wait for the full ~50 s pipeline to confirm the redirect path; that flow is identical to Phase 5's verified curl path which returned `seed_status: "full"` and a working form. Successful generation calls `router.push('/respond/${id}')` and the overlay unmounts as the route changes.
5. **Anonymous toggle.** Click toggles the checkmark on/off. State persists with form data — submitting with `anonymous: true` is exercised end-to-end every time we curl the same endpoint without a name question.
6. **/respond + identity error state.** Both paths verified by code review and Phase 5's earlier walkthrough; the new error component renders for any 502 from `/api/complete-session`, with the retry button visible until 2 attempts have failed.
7. **Negative test for the identity flow** wasn't re-run live in Phase 6 (Phase 5 flagged this — would require restarting the dev server with a deliberately invalid `SARVAM_API_KEY`). Code path: `/api/complete-session` returns 502 → CompleteStage's `fetchIdentity(false)` catches → sets `identityError` → designed dark card with retry button renders. Verified by reading the code; same pattern Phase 5 documented.

## Verification

- `npx tsc --noEmit` — passes.
- `npm run build` — passes.
- `npx eslint .` — **17 problems (11 errors, 6 warnings)**, down from 19 (11 errors, 8 warnings). Spec target was "reduce error count from 19 to ~10-13" — landed at 11 errors. The remaining 11 errors are all pre-existing: 7 in `RespondentFlow.tsx` (`react-hooks/set-state-in-effect` patterns the harness rule flags but that aren't connected to Phase 6 work) and 4 in `scripts/seed.ts` (legacy `any` types; spec said don't modify). The 2 warnings I cleared were the AIPresence-import and leftBg-variable warnings caused by the hidden-panel removal.
- Browser console on `/create`: clean — no errors, no warnings.

## Items wanting human review

1. **Loading overlay overlap on first frame.** When the user clicks Generate the overlay fades in over 0.4 s. There's a ~250 ms window where you can faintly see the form underneath through the radial-gradient veil before the dot/copy fully animate in (visible in the screenshot). It looks intentional ("the form fades into a blue mist") but if you want a hard cut, drop the `motion.div initial={{ opacity: 0 }}` to `initial={{ opacity: 0.95 }}` or remove the transition. Subjective; left as-is.

2. **Stage timings are pure guesses.** I picked 12 / 26 / 40 / 52 s based on Phase 5's measured ~50 s pipeline. If the pipeline actually takes 30 s on a snappy day or 70 s on a slow one, the user will see "Almost ready…" too early or too late. The copy is honest in saying "about a minute" — the only real risk is the user seeing "Almost ready…" then waiting another 20 s, which feels like a fib. Could be tightened by reading actual telemetry into the route's response headers (no implementation; flag).

3. **502 retry button reuses `handleSubmit`.** That's fine for transient Sarvam blips. But if the 502 was caused by the form payload (e.g. some unforeseen schema rejection upstream) the retry will fail forever. Not worth handling speculatively in this scope; spec called this out as acceptable hackathon behaviour.

4. **Identity retry calls `/api/complete-session` again.** The endpoint is idempotent — it overwrites `sessions.identity_label` on success. So a retry that finally succeeds correctly settles the row. But if Sarvam returns *different* archetypes on retry (it shouldn't with temp 0.6, but it could), the user could see one label briefly before getting a different one on a final retry. Harmless; flag.

5. **Anonymous toggle is a custom button, not a native checkbox.** It's keyboard-focusable (it's a `<button>`) and toggles correctly with Enter/Space, but screen-reader semantics are weaker than a real `<input type="checkbox">`. The visual treatment is matched to Pulse; switching to a native checkbox would require restyling (off-the-shelf checkbox is too small / too generic). Trade-off: kept the pulse-y look. Flagging for accessibility review.

6. **Mobile layout.** Tested only at desktop. The white meta card might overflow on narrow screens; the dashed "Add question" button uses `w-full` which should adapt. Spec said mobile is out of scope.

7. **`/api/forms` legacy endpoint is now orphan code.** No UI calls it. Spec said to leave it for backward compatibility with potential script consumers; I added neither a deprecation banner nor any code change there. If this ships and analytics show zero hits in a month, it's a one-line delete.

8. **The drive-by `RespondentFlow.tsx` cleanup removed `TONE_BG` and `leftBg`.** They were only used by the hidden panel I removed, so they're dead code. Strictly speaking the spec said "Do not modify `RespondentFlow.tsx` beyond the ReactionPopEmoji and hidden-panel-animation fixes" — I read the cleanup as a direct consequence of fix 4c (removing dead consumers of code I just removed). If the intent was to keep `TONE_BG` around as a future hook, it can be re-added; right now there's nothing pointing at it.

9. **`components/AIPresence.tsx` is now imported only as a type.** Drive-by 4c removed the only runtime use. The component file itself is left untouched. Same observation as the legacy endpoint — orphan code, but kept around for the eventual paper-shader avatar work.
