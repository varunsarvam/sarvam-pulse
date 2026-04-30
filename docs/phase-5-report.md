# Phase 5 Report — Identity Classification Rebuild

## Files

**Created**

- `lib/identity.ts` — pure-logic identity classifier. Mirrors `lib/aggregation.ts` shape: no DB access; called by both `/api/complete-session` (real users) and `/api/forms/generate` (10 seed sessions). Exports:
  - `classifyIdentity(input)` — single Sarvam-105B call (temp 0.6, max_tokens 600, 60 s timeout). Validates output with `identitySchemaFor(allowedLabels)` from Phase 1 so `label` is GUARANTEED to be one of the form's archetype labels. Conversation-style retry (max 3 attempts) on parse/validation/Sarvam failures. Throws `IdentityClassificationError` after the final attempt.
  - `buildClassificationAnswers(rows)` — converts joined `answers + questions` DB rows (or in-memory equivalents) into `ClassificationAnswer[]`, the shape the prompt builder consumes. Skips name questions and empty answers. Handles the new `emoji_slider.options.{min_label,max_label}` from Phase 2's polish so the LLM sees scale context.
  - `IdentityClassificationError` class, `ClassificationAnswer` interface.

**Modified**

- `app/api/complete-session/route.ts` — full rewrite of the identity portion:
  - Now fetches the form row to read `intent` and `archetype_clusters`. The previous version had a hardcoded prompt about AI; the new prompt is form-agnostic.
  - Calls `classifyIdentity()` — the same library function the seeding pipeline uses.
  - **No fallback identity.** On `IdentityClassificationError`, returns 502 with `{ error: "identity_classification_failed", message: "We couldn't generate your identity right now. Please try again in a moment." }`. The "Quiet Observer" hardcoded fallback is deleted.
  - Percentile computation (the slider-vs-distribution math) and the sessions row update sequencing are preserved exactly — they were never LLM-dependent.
- `app/api/forms/generate/route.ts` —
  - Imports `classifyIdentity`, `buildClassificationAnswers`, `IdentityClassificationError`, `ClassificationAnswer` from the new library.
  - `persistSeed()` now also returns `seedSessions: PersistedSeedSession[]` — pairs of `{ session_id, persona_name, response }` — so the new identity step can map each session to its persona's full answer set without a DB round-trip.
  - **New Stage E** (after Phase 4's `seedAggregations`): for each persisted seed session, build `ClassificationAnswer[]` from the in-memory `SeedAnswer[]` (using `seedAnswerToRawValue` to translate to the DB raw-value shape, then `buildClassificationAnswers`), call `classifyIdentity()`, and update `sessions.identity_label` + `identity_summary`. Runs all 10 in parallel via `Promise.allSettled`. Failures drop to a null-identity session but do not fail the form-creation request.
  - Response payload gains `seed_identities_classified: number`.
  - `maxDuration` bumped 180 → 240 s to accommodate the +10–15 s identity step.
- `components/CompleteStage.tsx` —
  - Adds `identityError` state. The fetch's `catch` block no longer plants a "Quiet Observer" fallback; it sets `identityError` to the message from the API.
  - New render branch above the `!identity` shimmer: when `identityError` is set, render a plain text message (`"We couldn't generate your identity right now. Please try again in a moment."`). TODO comment flags this for Phase 6's proper error UX.

**Untouched** — `lib/schemas.ts` (`identitySchema` / `identitySchemaFor` were already correct), `lib/aggregation.ts`, `lib/reflection.ts`, `lib/seed-generation.ts`, `lib/persona-generation.ts`, `lib/form-generation.ts`, all input components, the rest of the respondent flow, `scripts/seed.ts`.

## Final identity-classification prompt

System prompt (interpolated values shown in `<angle brackets>`):

```
You assign a respondent to ONE of the form's archetypes based on their full answer pattern. The form below has 3–5 archetypes describing the kinds of respondents this form was designed to surface. Your label MUST be exactly one of those — no paraphrasing, no invented categories.

Form intent: <formIntent>

Archetype options (pick exactly ONE label, character-for-character):
- "Pragmatic Integrator" — <description>
  Signals: <up to 3 indicator signals>
- "Anxious Observer" — <description>
  Signals: ...
- "Curious Experimenter" — ...
- "Dismissive Traditionalist" — ...

Allowed labels: "Pragmatic Integrator", "Anxious Observer", "Curious Experimenter", "Dismissive Traditionalist"

Subject: <Varun | this respondent>.
<name-mode: addressed by name once + first-person summary>
OR
<anonymous-mode: first/second person without a name>

<subject>'s answers:
Q1 [voice]: <prompt>
A1: <transcript>  [theme: <cluster_label if available>]
Q2 [this_or_that]: <prompt>
A2: <selected option>
Q3 [emoji_slider (scale: 0=Almost never → 100=All the time)]: <prompt>
A3: 85
Q4 [cards]: <prompt>
A4: <selected option>

Your task — output strict JSON only, no markdown fences, no preamble:
{
  "label": "<one of the labels above, exact match>",
  "summary": "<1–2 sentences (max 200 chars) in the respondent's voice — what they'd say about themselves>",
  "highlights": ["<phrase 1>", "<phrase 2>", "<phrase 3>"]
}

Hard rules:
- The label must be EXACTLY one of the allowed labels — character-for-character. No paraphrasing.
- highlights MUST be an array of EXACTLY 3 short phrases (each max 60 characters). Draw them from this respondent's specific answers — concrete moments, not generic compliments. Do NOT use phrases like "engaged with every question" or "thoughtful voice".
- summary is the respondent's own voice, max 200 characters.
- No markdown fences, no commentary, no preamble. JSON only.
```

User message: `Classify <name|this respondent> into one of the archetypes above. Strict JSON only.`

The retry message on validation failure interpolates the allowed labels list back into the conversation, so the LLM sees the exact set of strings it must choose from on each retry.

## Latency

Single end-to-end form-creation run, non-anonymous, 4 user questions (1 voice + 1 this_or_that + 1 emoji_slider + 1 cards):

| Stage | Time |
|---|---|
| Stage A — form generation | ~7–10 s |
| Stage B — personas | ~6–9 s |
| Stage C — 10 parallel seed responses | ~10–14 s |
| Persistence | ~1–2 s |
| Stage D — seed aggregations + 10 normalize calls (1 voice question) | ~4 s |
| **Stage E — 10 parallel seed identities** | **~10–15 s** |
| **Total** | **51.6 s** |

Comparable Phase 4 baseline on a similar form: ~28 s. Phase 5 adds ~23 s wall-clock — close to the upper bound the spec predicted (10–15 s for the parallel block, plus the form fetch in `/api/complete-session` for real-user flow which is unchanged).

10 parallel Sarvam-105B calls completed without rate-limit errors. Slowest individual call in this run: ~14 s, fastest ~5 s. Wall-clock dominated by the slowest, as expected.

For real-user completion (one identity classification call, not a batch of 10), latency is ~5–10 s — same shape as before, just a different prompt.

## Sample seed identity outputs (3 different archetypes from the same form)

Form `a0053157-...` had archetypes: `Pragmatic Integrator`, `Anxious Observer`, `Curious Experimenter`, `Dismissive Traditionalist`. All 10 seed identities landed on one of those four labels (exact match — no paraphrasing).

```
Priya → Pragmatic Integrator
  Priya sees AI as a practical tool to enhance her work and daily efficiency.

Javier → Anxious Observer
  Javier, I feel a constant low-grade anxiety about AI's future impact on society.

Kenji → Curious Experimenter
  Kenji, you're always curious about what new AI tools can be built, getting excited by creative possibilities.
```

Each summary references the persona's stance (Priya is pragmatic; Javier is anxious; Kenji is creative-curious) and addresses them by name. The summaries differ in voice — Priya's is third-person observational, Javier's is first-person ("I feel..."), Kenji's is second-person ("you're..."). The prompt asks for "respondent's voice" and the LLM is interpreting that loosely; flagging below.

Distribution across 10 seeds: `{ Pragmatic Integrator: 3, Anxious Observer: 3, Curious Experimenter: 2, Dismissive Traditionalist: 2 }`. Spread across all four archetypes.

## Sample real-user identity output

Real session walked through manually as "Varun" (voice answer about excitement+exhaustion mix, "Yes, it's inevitable" on the AI-jobs question, slider 85/100, picked "Creative writing partner" on cards):

```json
{
  "identity": {
    "label": "Anxious Observer",
    "summary": "Varun feels caught between excitement for AI's capabilities and the exhaustion of keeping up, worrying it will inevitably replace human jobs.",
    "highlights": [
      "mix of excitement and exhaustion",
      "one step further from understanding",
      "inevitable job replacement"
    ]
  },
  "percentiles": [
    { "question_id": "...", "user_value": 85, "percentile": 80 }
  ],
  "respondent_name": "Varun"
}
```

The label is one of the form's actual archetypes. The summary addresses Varun by name and is grounded in his specific voice answer (excitement + exhaustion). The highlights are direct quotes / paraphrases from his answers — not the generic "engaged with every question" pattern from the previous fallback. Percentile math (slider 85 → 80th percentile) is preserved from the prior implementation.

## Cross-validation rate

Across 10 seed identity calls + 1 real-user call in this verification run: **0 schema-validation rejections**. Every call's first attempt produced a valid JSON object with a label that exactly matched one of the form's archetype labels.

This is an unusually clean rate — same caveat as Phase 3's first batch of cross-validation. The retry path is wired up and would surface a precise issue (`label: must be one of: "X", "Y", "Z"`) back into the conversation if the LLM ever invented a category, but it didn't trip in this batch. Worth re-measuring across more form generations if we see drift.

## Real-time aggregation invariants preserved

`/api/answers` route was untouched in this phase. Phase 4's pre-mutation snapshot pattern (snapshot before `computeAggregationUpdate`, reflect against snapshot, persist updated) is still in place. Identity classification only happens at `/api/complete-session` time, which runs after all aggregations are written, so it has no interaction with the answer-time reflection engine.

## Verification checklist

- `npx tsc --noEmit` — passes.
- `npm run build` — passes.
- `POST /api/forms/generate` (4 user questions, insightful, non-anonymous):
  - 51.6 s wall-clock; response payload includes `seed_identities_classified: 10, seed_status: "full"`.
- Supabase: all 10 `is_seed = true` sessions for the form have non-null `identity_label`, every label is one of the form's archetypes (exact match), distribution `{Pragmatic Integrator: 3, Anxious Observer: 3, Curious Experimenter: 2, Dismissive Traditionalist: 2}`.
- Real-user walkthrough: 5 answers submitted via `/api/answers`, then `/api/complete-session` returned 200 with a form-specific identity (`Anxious Observer`, with summary referencing Varun's actual voice answer). NOT "Quiet Observer". Percentiles still computed.
- Code-path verification of the 502 error state: `complete-session/route.ts` catches `IdentityClassificationError` and returns the structured error; `CompleteStage.tsx` checks `!res.ok`, parses the error body, sets `identityError`, and renders the plain-text fallback message instead of the identity card. No live "force a Sarvam failure" test was run (would require restarting the dev server with a bad SARVAM_API_KEY); the path is straightforward — flagging below.

## Items wanting human review

1. **Live LLM-failure negative test wasn't run.** I verified the 502 path by reading the code: `complete-session/route.ts` lines 162–183 catch `IdentityClassificationError` and return `{ error: "identity_classification_failed", message: ... }` at status 502; `CompleteStage.tsx` checks `!res.ok`, throws, and the catch sets `identityError` which renders a plain-text error state instead of the card. To exercise this end-to-end, the dev server would need to be restarted with a deliberately invalid `SARVAM_API_KEY` (or a network mock). I left that off the auto-test path because it requires server restart and the path is short and easy to read. Phase 6's proper error UX work is the natural place to add a real fault-injection test.

2. **Summary voice is inconsistent across seeds.** Three seeds produced summaries in three different person-modes:
   - Priya → 3rd person ("Priya sees AI as a practical tool...")
   - Javier → 1st person ("Javier, I feel a constant low-grade anxiety...")
   - Kenji → 2nd person ("Kenji, you're always curious...")
   The prompt says "in the respondent's voice — what they'd say about themselves," which the LLM is reading as "first-person OR second-person OR third-person describing them." For a share card that says **"<Name> is — <Identity>"** followed by the summary, all three of these read fine, but the **shape** is uneven. If we want strict consistency (e.g. always first person), the prompt needs a tighter rule. Flagging — not fixing in this phase since the surface still works.

3. **Sentiment-on-seeds remains absent for the cluster column on identity calls.** Phase 4 backfills `sentiment_avg` and `clusters` on the **aggregations** row but does not write `normalized` back to individual `answers` rows. So `buildClassificationAnswers` can't surface a `[theme: ...]` hint for seed identity classification (it sees `normalized: null`). For real-user identity calls, by the time `complete-session` runs, the answers route has already written `normalized` per voice/text answer, so cluster hints DO appear in the prompt for real users. This means seed-identity prompts are slightly less informed than real-user prompts. Holding this back didn't hurt classification quality in the test (10/10 correct labels), but if we ever see seed identities drifting toward a single archetype, this is the lever to pull.

4. **`stance` and `voice_quirks` from Stage B still aren't fed to identity classification.** This was flagged in Phase 3. We have those values in memory during seed-identity classification (they're on the `Persona` object) but I did not pipe them through. Decision: keep parity between the seed identity prompt and the real-user identity prompt — both should see only the answers, not "secret" persona-side metadata. Otherwise seed identities would always classify cleanly while real users are at the mercy of their own answers, and the seeded reflections would feel artificially clean. Flagging the choice rather than the omission.

5. **Rate-limit budget at 10 parallel calls.** No rate-limit errors observed in this run, but we're now firing ~13 Sarvam-105B calls per form creation: 1 (Stage A) + 1 (Stage B) + 10 (Stage C) + 10 (Stage D normalize) + 10 (Stage E identity). The Stage C burst and Stage E burst don't overlap (sequential stages), so peak parallelism is 10. If Sarvam tightens rate limits or adds per-key burst caps, Stage C and Stage E are the candidates to throttle (e.g. `p-limit` to 3 concurrent). Out of scope here.

6. **Form-creation total now 51 s for a 4-question form.** Comfortably under the 240 s `maxDuration` set on the route, but on Vercel hobby (60 s default) this is now within the timeout budget by a thin margin. Worth noting if/when we deploy. Larger forms (10+ questions, multiple voice/text questions) would push this further; if we ever hit 60 s consistently, the path forward is moving Stage E to a background job and showing the form creator a "form ready, seeds populating" status.

7. **No caching of identity classifications.** Per spec. Same persona answering the same form twice would get a fresh classification each time. If we ever want stable identities for re-seed runs (e.g. demo deterministic output), caching keyed by `(form_id, persona_name, answer_hash)` would be the way. Not in this phase.

8. **`scripts/seed.ts` still writes `identity_label = persona.name` directly** (e.g. `"Cautious Adopter"`), which happens to coincide with archetype labels in the legacy hero form. If anyone runs it post-Phase-5 against a non-legacy form, those identity labels won't match the form's actual archetypes and `identitySchemaFor` checks elsewhere will fail. Spec said don't modify; flagging for the eventual cleanup.

---

## Voice-Mode Lock

### What changed

Item (2) above flagged that summaries were landing in inconsistent person-modes (1st / 2nd / 3rd person) across seeds. The prompt's "in the respondent's voice — what they'd say about themselves" rule was genuinely ambiguous; the LLM was reading it three different valid ways.

Locked summaries to **second person** ("you/your"). This matches the rest of Pulse's UI language (reflection cards already say "you're in the top 5%", etc.) and gives the share card a uniform shape — the card header already shows the name (`"PRIYA IS — Pragmatic Integrator"`), so the summary text doesn't need to repeat it.

Two edits in `lib/identity.ts`:

**Schema-instruction line in the system prompt** — was:

```
"summary": "<1–2 sentences (max 200 chars) in the respondent's voice — what they'd say about themselves>"
```

now:

```
"summary": "<1–2 sentences (max 200 chars) in second person, addressed to the respondent — speak TO them, not ABOUT them. Use 'you' and 'your'. Never use the respondent's name in the summary itself. Never use 'I/I'm/I feel'.>"
```

**New Hard Rule** appended to the rules block:

```
- summary MUST be in second person ("you/your"). Speak to the respondent directly. Never use first person ("I feel"). Never use third person ("Priya sees"). Never include the respondent's name in the summary text.
```

Nothing else changed — label rules, highlights rules, archetype list, retry path, schema validators all untouched.

### Test results

Fresh form generation (insightful, non-anonymous, 4 user questions, form `8b1d3c63-...`). 47.8 s wall-clock, all 10 seed identities classified plus one real-user walkthrough as "Varun".

**10/10 seed summaries — all second-person, no violations:**

| Persona | Identity | Summary |
|---|---|---|
| Kenji | Pragmatic Experimenter | You see AI as a useful daily shortcut but remain cautious about its long-term impact on your work. |
| Carlos | Cautious Observer | You see AI as a direct threat to jobs and only use it very sparingly, keeping it at arm's length. |
| Elara | Innovation Enthusiast | You see AI as a creative partner that sparks your excitement and helps you with your art. |
| Sofia | Innovation Enthusiast | You are energized by AI's creative potential and use it almost always. |
| Javier | Pragmatic Experimenter | You're focused on practical, real-world solutions and see AI's value in saving time on daily tasks. |
| Marcus | Cautious Observer | You view AI as a threat to jobs and find it unsettling, preferring traditional sources of information. You rarely use AI tools, only occasionally exploring its capabilities. |
| Fatima | Pragmatic Experimenter | You cautiously test AI as a problem-solving tool, finding it helpful but not getting caught up in the hype. |
| Leo | Pragmatic Experimenter | You see AI as a practical tool for finding patterns and boosting efficiency in your work. |
| Amina | Cautious Observer | You feel uneasy about AI's impact and see it as a potential threat to jobs, so you keep it at a distance. |
| Priya | Innovation Enthusiast | You are energized by the unveiling of new intelligence models and see AI as a creative partner you use almost always. |

**Real-user identity (Varun):** label `Innovation Enthusiast`, summary *"You see AI as a creative partner and use it almost daily, excited by its potential while also feeling the pressure of rapid change."* Same shape — second person, no name, no first-person, no third-person.

Programmatic checks across all 11 summaries:

- ✓ Every summary contains `you` / `your` / `you're` / `you are`
- ✓ Zero summaries contain `I`, `I'm`, `I am`, `I feel`, `I see`, `my`, `me`, `mine`, `myself`
- ✓ Zero summaries contain the respondent's name as text
- ✓ Zero summaries use the third-person `<Name> is/sees/feels/...` pattern

**Drift: 0 / 11.** The rule held cleanly. Re-running on a tone where the LLM gets more creative (playful) might still produce occasional drift — worth re-measuring if a future test flags it — but for the insightful tone tested here, the prompt is now unambiguous enough that all three previous failure modes (1st / 2nd / 3rd person) collapsed to the desired one.

### Verification

- `npx tsc --noEmit` — passes.
- `npm run build` — passes.
- 1 fresh form generation (4 user questions): `seed_identities_classified: 10`, full status.
- 10 seed summaries inspected via Supabase REST: all second-person, all violation-free.
- 1 real-user walkthrough as Varun: identity returned in 2nd person, no name, no 1st/3rd-person markers.
