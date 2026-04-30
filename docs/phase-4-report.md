# Phase 4 Report — Aggregation Seed (Stage D)

## Files

**Created**

- `lib/aggregation.ts` — single source of truth for the per-question aggregation rollup. Exports:
  - `computeAggregationUpdate(current, questionId, answer)` — pure function; takes the current row (or `null`) plus one new answer and returns the next row. No DB access. Used by both the live answers route and the seeding pipeline.
  - `seedAggregations(formId, questions, seedAnswers, { backfillSentiment })` — bulk-folds Phase 3's seed answers into per-question `aggregations` rows. Optionally calls `normalizeAnswer()` for voice/text answers (sequential within a question so cluster labels can be reused).
  - Helpers re-exported for the answers route to keep behaviour identical: `sliderBucket`, `defaultAggregation`, `cloneAggregation`, `extractAnswerText`.
  - Types: `AnswerInput`, `SeedAnswerWithMeta`, `SeedAggregationQuestion`.

**Modified**

- `app/api/answers/route.ts` — Phase 3 of the route's 6-phase pipeline (the inline aggregation logic) now reduces to a single `computeAggregationUpdate(...)` call. The pre-mutation snapshot pattern (clone before update so the reflection engine sees the prior state) stays in the route. The four helpers (`sliderBucket`, `defaultAggregation`, `cloneAggregation`, `extractAnswerText`) are imported from `lib/aggregation.ts` rather than declared locally. Behaviour is byte-identical to before.
- `app/api/forms/generate/route.ts` —
  - Added `intent` to the question-insert `.select()` so we can pass it to `normalizeAnswer()`.
  - Built a parallel `aggregationQuestions: SeedAggregationQuestion[]` list alongside `questionsByPosition` so seeding gets the (id, input_type, intent) trio without an extra DB read.
  - `persistSeed()` now also returns `seedAnswers: SeedAnswerWithMeta[]` — the in-memory list of rows it just inserted, so seeding works from memory.
  - After persistence, calls `seedAggregations(form.id, aggregationQuestions, persistResult.seedAnswers, { backfillSentiment: true })`. Failures are logged but do not fail the request — the form is still usable, just less rich for early respondents.
  - Response payload gains `aggregations_seeded` and `normalize_calls`.

**Untouched** — `lib/reflection.ts`, `lib/llm.ts`, `lib/seed-generation.ts`, `lib/persona-generation.ts`, `lib/form-generation.ts`, `lib/schemas.ts`, the respondent flow, all input components, `scripts/seed.ts`.

## Decisions

**Sentiment backfill: YES.** Spec said "try the fast path first." Measured cost: 20 `normalizeAnswer()` calls (10 personas × 2 voice/text questions) added ~2.5s wall-clock to a 5-question form (28.5s vs Phase 3's ~26s baseline). That's well under the 5s threshold the spec called out, and well worth it — without backfill, the first real respondent on a voice/text question would see `clusters: []` and `sentiment_avg: 0`, which means the reflection engine has nothing to do with their answer. With backfill, clusters are populated from session 1.

Concretely: backfill runs `normalizeAnswer()` sequentially within each voice/text question (so the cluster list grows and the LLM can reuse labels) and in parallel across questions (clusters are per-question, no cross-talk). For the 5-question test that's two parallel chains of 10 sequential normalize calls each, which lands in ~2.5s end-to-end at Sarvam's ~250ms/call median.

**Cluster + sentiment are joined.** Spec called this out as a tied decision: same Sarvam call gets you both. Backfilling sentiment automatically backfills clusters. No separate code path.

**Library is the single source of truth.** The aggregation logic lives in `lib/aggregation.ts`; both `/api/answers` (one answer at a time, real time) and `/api/forms/generate` (10 personas × N answers, batch) call the same `computeAggregationUpdate()`. The route handler keeps its own sequencing concerns (read existing, snapshot for reflection, compute, persist) but defers all the math.

**Pure-function separation.** `computeAggregationUpdate()` doesn't touch the DB. The caller is responsible for read-then-write. This kept the refactor of the answers route safe — only the math moved, the read/write/reflection sequencing stayed exactly where it was.

**`name` questions are no-ops in aggregation.** The answers route already short-circuits `name` answers before reaching the aggregation phase, but the library defensively handles them too: `seedAggregations` skips name questions entirely (no row is upserted), and `computeAggregationUpdate` falls through with no distribution/cluster updates if a name answer somehow arrives.

**Verbatim lift, not a rewrite.** Per spec, the cluster handling preserves the existing if-else duplication (the `is_new` branch and the find-or-push branch) rather than collapsing into find-or-create. This guarantees byte-identical behaviour to pre-Phase-4 in the live path.

## Latency

Same form shape (5 user questions, 1 voice + 1 text, non-anonymous) measured before vs after Phase 4:

| | Phase 3 baseline | Phase 4 |
|---|---|---|
| Total wall-clock | ~26 s | **28.5 s** |
| Stage A (form gen) | ~7–10 s | unchanged |
| Stage B (personas) | ~6–9 s | unchanged |
| Stage C (seeds, parallel) | ~10–14 s | unchanged |
| Persistence | ~1–2 s | unchanged |
| **Stage D (aggregation seed)** | n/a | **~2.5 s** (20 normalize calls, sequential per Q, parallel across Qs) |

20 normalize calls in 2.5 s ≈ 125 ms/call wall-clock. Well within the 5 s spec budget.

For closed-input-only forms (cards, this_or_that, ranking, emoji_slider), Phase 4 adds essentially nothing — `seedAggregations` skips the normalize loop and runs only the `computeAggregationUpdate` fold + 5 upserts in well under a second.

## Sample aggregation row from a freshly-seeded form

The voice question on the test form (`When AI shows up in your day, what single feeling stands out most?`):

```json
{
  "question_id": "3d7eea18-8e43-480e-96f8-4e16a9da5f3e",
  "total_responses": 10,
  "distribution": {},
  "sentiment_avg": 0.32,
  "recent_quotes": [
    "It's a curious hum of potential, a kind of digital echo of consciousness. It fee",
    "It's a productivity multiplier. Just another efficient layer in the stack.",
    "Honestly? It's a constant, low-grade anxiety. I see it everywhere and it just fe",
    "When AI pops up, it's pure 'insane' excitement. No joke, it feels like the futur",
    "Well, it's a sort of hopeful relief, you see. I just hope it doesn't make us for",
    "I find it all rather distracting. It seems to happen to everyone without any rea",
    "tbh, it's just... neutral? Like it's a tool, so it doesn't really have a feeling",
    "It's genuinely intriguing! When AI pops up, the feeling isn't one of fear or ann",
    "Efficiency. AI saves time on repetitive tasks. It's a tool, not a person.",
    "I guess it's kind of a mix of cautious optimism and underlying anxiety, I mean, "
  ],
  "clusters": [
    { "label": "cautious optimism", "count": 7, "examples": [ ...5 examples... ] },
    { "label": "neutral stance", "count": 1, "examples": [ "tbh, it's just... neutral? ..." ] },
    { "label": "distracting nuisance", "count": 1, "examples": [ "I find it all rather distracting..." ] },
    { "label": "curious optimism", "count": 1, "examples": [ "It's a curious hum of potential..." ] }
  ]
}
```

The cards question (`Which AI capability sparks your imagination the most?`):

```json
{
  "question_id": "bd0c43a1-7f4c-4337-aadc-38fed5103314",
  "total_responses": 10,
  "distribution": {
    "A new kind of artist": 2,
    "A tireless researcher": 1,
    "Instant problem-solver": 1,
    "Automating tedious tasks": 5,
    "Creative brainstorming partner": 1
  },
  "sentiment_avg": 0,
  "recent_quotes": [...10 entries — the option strings, since cards have no transcript...],
  "clusters": []
}
```

The emoji_slider question (`How much do you actually use AI tools right now?`):

```json
{
  "total_responses": 10,
  "distribution": { "0-20": 2, "20-40": 5, "60-80": 3 },
  "sentiment_avg": 0,
  "recent_quotes": [ "30", "75", "10", "25", "30", "10", "30", "30", "65", "60" ]
}
```

(`recent_quotes` for closed inputs are the stringified value/option, which is the existing behaviour and not Phase 4's choice — `extractAnswerText` returns the raw value when there's no transcript.)

## Real-time aggregation still works

Submitted one fresh answer to the cards question post-Phase-4:

| State | total_responses | "Automating tedious tasks" |
|---|---|---|
| Pre-submit (after seed) | 10 | 5 |
| POST `/api/answers` body: `{type: "cards", value: "Automating tedious tasks"}` | — | — |
| Post-submit | **11** | **6** |

The reflection engine returned `{ type: "majority" }` for the response, which is correct (60% of post-write voters now picked that option). Counts incremented correctly, and the reflection picked from the **pre-mutation** aggregation snapshot (5/10 = majority before the user's vote was added) — so the user doesn't see their own answer reflected back at them. The pre-mutation invariant is preserved.

## Verification checklist

- `npx tsc --noEmit` — passes.
- `npm run build` — passes.
- Curl `/api/forms/generate` (5 user questions, 1 voice + 1 text, insightful, non-anonymous):
  - 28.5 s wall-clock; response includes `aggregations_seeded: 5, normalize_calls: 20, seed_status: "full"`.
- Supabase: 5 aggregation rows for the 5 user questions (name skipped). Each row has:
  - `total_responses = 10` ✓
  - Closed-input `distribution` populated (cards: 5 keys; this_or_that: 2 keys 5/5; emoji_slider: 3 buckets) ✓
  - Voice/text `sentiment_avg ≠ 0` (0.32 voice, 0.53 text) ✓
  - `recent_quotes` has 10 entries per question ✓
  - Voice/text `clusters` populated (4 and 5 clusters respectively, with multi-example clusters) ✓
- Live respondent flow simulation: POST to `/api/answers` for a cards question increments `total_responses` 10→11 and the chosen-option counter 5→6, with the reflection picked from the pre-mutation snapshot.

## Items wanting human review

1. **Sequential-within-question normalize is the bottleneck.** For a form with N voice/text questions and K personas, total normalize wall-clock is ~K × 250 ms = ~K × time-per-call. For K=10 that's ~2.5 s per voice/text question, but they run in parallel across questions, so adding more voice/text questions doesn't blow up the budget linearly. Still: a form with 5 voice questions adds ~2.5 s, which is fine. A form with 10 voice questions still ~2.5 s. Comfortable.

2. **Cluster quality depends on `normalizeAnswer()`'s temp 0.1 stability.** In the test, voice answers landed 7 in "cautious optimism" but 1 each in "neutral stance", "distracting nuisance", "curious optimism". Some of those are arguably the same cluster ("curious optimism" vs "cautious optimism"). The LLM saw the existing list at decision time, so it chose to mint a new label for "curious"-adjacent rather than reuse "cautious". This is the same fragmentation the live path has on the first few answers, so the seeded behaviour matches the steady-state behaviour. If we want tighter clustering at seed time, the next move is a post-pass that merges semantically similar labels — out of scope here.

3. **Recent-quotes for closed inputs is noise.** The `recent_quotes` column for cards/this_or_that/emoji_slider just stores the raw selected string ("Automating tedious tasks", "30", "I see it as progress") because `extractAnswerText` falls back to `value` when no transcript is present. The reflection engine correctly ignores these for tribe-style reflections (it uses the per-cluster examples instead), and the live ENTRY screen quote-ticker only renders quotes from voice/text questions — so this is harmless noise. But if any future surface reads `recent_quotes` blindly, it'll show option strings as "quotes". Spec said don't change behaviour — flagging.

4. **Existing pre-Phase-3 forms still have empty aggregations.** No backfill job runs over them. They'll populate as real respondents answer. Per the spec, this is by design — those forms predate the seeding pipeline and the experience for early respondents will be the original "no social context" state. If we want to retroactively seed them, it's a one-shot migration script that calls `seedAggregations()` for each form using its existing seed sessions (if any). Not in this phase.

5. **`seedAggregations` doesn't roll back on partial failure.** If the upsert succeeds for 4/5 questions and fails for the 5th, we keep the 4 and log the 5th. The form is still usable — the question with no aggregation just runs from-scratch on the first real respondent, same as a pre-Phase-3 form. No orphan state to clean up since `aggregations` is keyed by `question_id` and re-runs are idempotent.

6. **Anonymous mode: clusters use the LLM's chosen labels.** No change vs non-anonymous. The persona's name doesn't appear in the cluster list, so anonymous and named runs produce identical-shape aggregations.

7. **`scripts/seed.ts` aggregation logic is now stale relative to the library.** The legacy script computes its own aggregations inline (lines 494–581) using slightly different bucketing for emoji_slider and a different distribution shape for ranking (sums, not running averages). It's only used against pre-existing forms, but if anyone runs it post-Phase-4 the aggregations table will get clobbered with the legacy shape. Spec said don't modify it; flagging for the eventual cleanup.
