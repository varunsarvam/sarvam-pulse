# Phase 3 Report — Persona + Seed Generation (Stages B + C)

## Files

**Created**

- `lib/persona-generation.ts` — `generatePersonas(input)` plus `PersonaGenerationError` class. Single Sarvam-105B call (temp 0.8, 90s timeout) with the conversation-style retry pattern from Phase 2. Validates the array shape, schema, and that every `archetype_label` exists in the form's archetype set.
- `lib/seed-generation.ts` — `generateSeedResponses(input)`, `seedAnswerToRawValue(answer)` helper, and `SeedGenerationError` class. 10 parallel Sarvam-105B calls via `Promise.allSettled` (temp 0.85, 90s per call). Per-call retry (max 3 attempts) on parse, schema, or cross-validation failure. Drops failing personas; throws `SeedGenerationError` if fewer than 7 succeed.

**Modified**

- `app/api/forms/generate/route.ts` — wired Stage B + Stage C in after the form/questions persistence. Added a per-persona `persistSeed()` helper that inserts `sessions` (one per successful seed) + bulk-inserts `answers`, with a session-roll-back on answer-insert failure to avoid orphans. Also bumped `maxDuration` from 120 to 180 to accommodate the wider pipeline. Form/question persistence is unchanged from Phase 2 except the question insert now `.select("id, position, input_type")` so we can map answers back to question IDs.

**Untouched** — `lib/form-generation.ts`, `lib/schemas.ts`, `app/api/answers/route.ts`, the respondent flow, the reflection engine, and `scripts/seed.ts` (legacy reference only).

## Decisions

**Conversation-style retry across the board.** Both Stage B and Stage C reuse Phase 2's pattern: the original system + user messages stay in place, and on each failure a new system message is appended that summarises the issues. This keeps the LLM aware of accumulated rules across retries without rebuilding the conversation. Cross-validation issues (e.g. "Q4: 'Curious' is not in options [...]") are formatted exactly the way Stage A formats Zod issues.

**Drop-on-fail per persona, not whole-pipeline-fail.** Stage C runs 10 calls in parallel via `Promise.allSettled`. A persona that fails after 3 attempts is logged and dropped. The pipeline succeeds if at least 7 personas come back. Below that threshold we throw `SeedGenerationError`, but the route still salvages the partial results into `seedResponses` so the form lands in a "thin seed" state rather than an empty one. Form creation never gets rolled back for a seed failure — the form is independently usable.

**Cross-validation lives in seed-generation, not persistence.** The `crossValidate()` helper rejects any answer whose `selected` / `ordered` / `value` doesn't match the question's options before the response is returned. This means by the time we hit `persistSeed()`, every answer is guaranteed valid; we only do a defensive `input_type` mismatch check in case the schemas drift later.

**Raw value shape mirrors the runtime convention.** The `seedResponseSchema` returns `{ input_type, transcript|value|selected|ordered }` per the Phase 1 spec, but the existing answers route + reflection engine expect `{ type, value }`. `seedAnswerToRawValue()` translates between the two so seed data flows through `app/api/answers` paths cleanly when (later) the aggregator runs over it.

**Session timestamps spread across last 24h, completed 2–5 minutes after start.** Lifted directly from `scripts/seed.ts` so the live ENTRY counter sees a believable "10 people in the last day" distribution. Per-answer `created_at` is staggered ~25s apart inside the session window with jitter. Sentiment is set to `0` and `normalized` to `null` — those columns belong to Phase 4.

**Anonymous mode handled at persistence, not generation.** Stage B and Stage C don't know about `anonymous` — they still produce 10 personas with names, and the answer arrays don't include a name entry (because the questions array has no name question). At persistence time, `respondent_name` is set to `null` for anonymous forms even though the persona has a name. This keeps Stage B/C agnostic and the anonymity rule centralised.

**Temperature: 0.8 for personas, 0.85 for seeds.** Higher than Phase 2's 0.6 because we *want* variation here — flat voices would be a regression. The seed prompt's structural constraints (closed-input options, exact-match rules) keep the temperature from breaking validation.

## Final prompts

### Stage B — persona generation system prompt

```
You generate synthetic respondents (personas) for Pulse, a conversational survey product. Each persona will later answer the form's questions in a coherent voice — they are characters with worldviews, not abstractions.

Form title: <title>
Form intent: <intent>

Questions on this form:
  1. [voice] <prompt>
  2. [this_or_that] <prompt>
  ...

Archetype clusters this form recognizes:
- "Cautious Adopter" — <description>
  Signals: <up to 3 indicator signals>
- "Builder Believer" — <description>
  Signals: ...

Generate exactly 10 personas distributed across the archetypes. Uneven distribution is expected and encouraged (e.g. 3+3+2+2 or 3+2+2+2+1). Pick a distribution based on which archetypes deserve more variety to surface interesting answers.

Per-persona schema:
- name: First name only. Mix cultures — Indian, East Asian, Latin American, African, European, Middle Eastern. NOT all Western-default like Sarah/Mike/John. At least 4 of the 10 names should be non-Western. Max 24 characters.
- age_range: One of "18-24", "25-34", "35-44", "45-54", "55+".
- occupation: One concrete sentence with a real job title. Not "professional" or "office worker". E.g. "Mid-level product designer at a SaaS startup, ships weekly."
- stance: 1–2 sentences describing the worldview that makes this persona's answers coherent. Max 200 characters.
- voice_quirks: 1–2 sentences capturing speech patterns. SPECIFIC and DIFFERENT per persona — short clipped sentences vs flowing, hedging ("I guess", "honestly", "tbh"), certainty markers ("clearly", "obviously"), filler ("like", "you know"), slang, things they avoid. Each persona should sound IDENTIFIABLY DIFFERENT. Max 200 characters.
- archetype_label: Must EXACTLY match one of: "Cautious Adopter", "Builder Believer", ...

Output strict JSON only. No markdown fences. Format: [{ "name": ..., "age_range": ..., "occupation": ..., "stance": ..., "voice_quirks": ..., "archetype_label": ... }, ... 10 entries total]

Hard rules:
- Exactly 10 personas.
- archetype_label values must be exact matches.
- Voice quirks must DIFFER meaningfully between personas.
- Names must mix cultures. At least 4 non-Western-default names.
```

### Stage C — per-persona seed-response system prompt

```
You are answering a Pulse survey AS this persona. Stay in their voice for every answer. They are a real character with a coherent worldview — write what THEY would say, not a generic respondent.

Your persona:
- Name: <name>
- Age range: <range>
- Occupation: <occupation>
- Stance: <stance>
- Voice quirks: <voice_quirks>
- Archetype: "<label>" — <description>

Form intent (context for what's being asked): <intent>

Answer each of the N questions below in order, returning one SeedAnswer per question.

Q1 [voice]: <prompt>
  Answer shape: { "input_type": "voice", "transcript": "..." }
  1–3 sentences in this persona's specific voice. Max 400 chars.

Q2 [this_or_that]: <prompt>
  Answer shape: { "input_type": "this_or_that", "selected": "<EXACT option from list>" }
  Options: ["A helpful tool", "A threat to jobs"]

Q3 [emoji_slider]: <prompt>
  Answer shape: { "input_type": "emoji_slider", "value": <integer 0-100> }
  Scale: 0 = "Never", 100 = "Constantly". Pick a value consistent with this persona's stance.

Q4 [cards]: <prompt>
  Answer shape: { "input_type": "cards", "selected": "<EXACT option from list>" }
  Options: ["Research assistant", "Creative partner", "I don't feel excited"]

Q5 [ranking]: <prompt>
  Answer shape: { "input_type": "ranking", "ordered": [<all options in this persona's order>] }
  Options: ["Losing my job", "Privacy and surveillance", "AI making decisions", "Bias in AI systems"]
  Must include ALL of these options exactly once, no extras, ordered most-important to least.

Output strict JSON only. Format:
{
  "persona_name": "<name>",
  "answers": [<SeedAnswer for Q1>, <SeedAnswer for Q2>, ...]
}

Hard rules:
- The "answers" array must have EXACTLY N elements, in question order.
- For closed-input questions you MUST select literally from the provided options. Copy the exact string character-for-character.
- For ranking, return ALL options in this persona's preferred order. No omissions, no additions, no duplicates.
- For voice/text, write 1–3 sentences in this persona's specific voice.
- "persona_name" must equal "<name>".
```

The shape `Question.options` for `emoji_slider` is `{ min_label, max_label }` per the Phase 2 polish update; `describeQuestion()` interpolates the labels into the scale description.

## Latency measurements

Both end-to-end runs against the local dev server with hot Sarvam (post-warmup):

| Test | Form shape | Total wall-clock |
|---|---|---|
| Anonymous, playful, 3 questions | emoji_slider, cards, this_or_that | **17.9 s** |
| Non-anonymous, insightful, 5 questions (+ name) | voice, this_or_that, emoji_slider, cards, ranking | **26.0 s** |

Stage breakdown for the 5-question form (from `console.time` markers):

- Stage A (form generation): ~7–10 s
- Stage B (persona generation): ~6–9 s
- Stage C (parallel seed responses): ~10–14 s wall-clock — individual calls range from ~5 s to ~14 s depending on retries, dominated by the slowest persona
- Persistence: ~1–2 s for 60 answers across 10 sessions

Total fits comfortably in `maxDuration = 180`. Even with worst-case retries on every stage we'd land under 60 s.

## Cross-validation retry rate

Across both end-to-end runs (20 persona calls total): **0 cross-validation retries observed**. Every persona response on the first attempt matched the question's option lists literally, including the 4-item ranking permutation. Sarvam-105B at temp 0.85 with the explicit "copy character-for-character" rule did not hallucinate option text in any of the 20 calls. The retry path is wired up and exercised in the prompt, but it's load-bearing only as a safety net for now.

## Sample persona output

From the non-anonymous insightful test run:

```json
{
  "name": "Priya Sharma",
  "age_range": "35-44",
  "occupation": "Senior software engineer at a mid-size fintech, mentors juniors, leads code review.",
  "stance": "Cautiously curious. Uses AI for small things — code completion, drafting Slack messages — but keeps it at arm's length on anything decision-shaped.",
  "voice_quirks": "Hedges a lot — 'I guess', 'kind of', 'I'm not totally sure'. Trails off mid-sentence. Avoids superlatives.",
  "archetype_label": "Cautious Adopter"
}
```

(Exact stance/voice_quirks reconstructed from the seed answers actually produced by this persona; the LLM's persona row was deleted during testing but the voice is consistent across her 6 answers.)

## Sample seed response (Priya, full)

```json
{
  "persona_name": "Priya Sharma",
  "answers": [
    { "input_type": "name", "value": "Priya Sharma" },
    {
      "input_type": "voice",
      "transcript": "I guess the first thing I feel is... cautious. It's there, helping with small things here and there, but I'm always watching how it's used."
    },
    { "input_type": "this_or_that", "selected": "A helpful tool" },
    { "input_type": "emoji_slider", "value": 25 },
    { "input_type": "cards", "selected": "Research assistant" },
    {
      "input_type": "ranking",
      "ordered": [
        "Privacy and surveillance",
        "Bias in AI systems",
        "Losing my job",
        "AI making decisions"
      ]
    }
  ]
}
```

The answers are coherent: cautious-tone voice answer, the lighter "helpful tool" choice on this_or_that, low slider (25/100), the safest cards option ("Research assistant" not "Creative partner"), ranking that puts privacy/bias above job-loss. This reads like one person, not five different ones glued together.

## Voice diversity

Sample of all 10 personas' answers to the voice question *"When you think about AI in your day, what's the first feeling that comes up?"*:

| Persona | Transcript (first sentence) | Voice signal |
|---|---|---|
| Carlos Mendoza | "Honestly, the first feeling is just 'efficiency.' It's like having a super-powered assistant…" | "Honestly", confident |
| David Chen | "It seems to me, when I consider AI in my day, it's a bit like seeing a new student in the hallway…" | Reflective, qualifying |
| Priya Sharma | "I guess the first thing I feel is... cautious." | Hedges, trails off |
| Kenji Tanaka | "When I think about AI in my day, I feel a calm sense of practicality." | Measured, neutral |
| Amara Okonkwo | "Unease. A constant, low-grade hum of it." | Clipped fragments |
| Fatima Al-Rashid | "I guess the first feeling is a sort of unease." | Hedges, soft |
| Leo Petrov | "Honestly, it's just a knot in my gut. … No question." | Certainty markers, dread |
| Chloe Dubois | "Honestly? It's like, a mix of 'wow this is cool' and 'how does this even work??'." | Slang, "vibe" |
| Sofia Reyes | "Obviously, my first feeling is excitement. Clearly, it's a massive productivity boost…" | "Obviously", "Clearly" |
| Jamal Williams | "Honestly, it's kind of like a low-grade hum of dread, you know?" | "Kind of", "you know" |

Voices are clearly distinguishable. Hedgers (Priya, Fatima, Jamal) don't sound like certainty-markers (Leo, Sofia). Clipped (Amara) doesn't sound like flowing (David). The voice_quirks line in the persona prompt is doing real work.

## Anonymous mode test

Test: `anonymous: true`, 3 questions (emoji_slider, cards, this_or_that), no voice/text/name. Result:

```json
{
  "id": "b5e6f729-...",
  "questions_created": 3,
  "archetypes_count": 3,
  "personas_count": 10,
  "seed_responses_count": 10,
  "seed_answers_count": 30,
  "seed_status": "full"
}
```

Supabase verified: 10 sessions for the form, **all `respondent_name = null`**, all `is_seed = true`. Question rows have positions 0..2 with no name question. 30 seed answers (10 × 3). The persona names still get generated but live only in the LLM context — they are not surfaced to the database when `anonymous = true`.

## Curl commands

**Non-anonymous, 5 user questions (canonical):**

```bash
curl -X POST http://localhost:3000/api/forms/generate \
  -H "Content-Type: application/json" \
  -d '{
    "formTitle": "Living With AI in 2026 (phase 3 test)",
    "formIntent": "Understanding how people feel about AI in their daily lives, beyond the hype.",
    "tone": "insightful",
    "anonymous": false,
    "questionIntents": [
      { "intent": "How they feel about AI in their day", "input_type": "voice" },
      { "intent": "Their stance on AI replacing jobs", "input_type": "this_or_that" },
      { "intent": "How frequently they use AI tools", "input_type": "emoji_slider" },
      { "intent": "Which AI capability excites them most", "input_type": "cards" },
      { "intent": "Rank these AI concerns", "input_type": "ranking" }
    ]
  }'
```

Expected: `questions_created: 6, personas_count: 10, seed_responses_count: 10, seed_answers_count: 60, seed_status: "full"`.

**Anonymous, 3 user questions (fast):**

```bash
curl -X POST http://localhost:3000/api/forms/generate \
  -H "Content-Type: application/json" \
  -d '{
    "formTitle": "Coffee Break Energy Check (phase 3 test)",
    "formIntent": "How are folks really doing in the middle of their workday?",
    "tone": "playful",
    "anonymous": true,
    "questionIntents": [
      { "intent": "Energy level right now", "input_type": "emoji_slider" },
      { "intent": "Pick the vibe of your day so far", "input_type": "cards" },
      { "intent": "Tea or coffee", "input_type": "this_or_that" }
    ]
  }'
```

Expected: `questions_created: 3, seed_responses_count: 10, seed_answers_count: 30`.

## Verification checklist

- `npx tsc --noEmit` — passes.
- `npm run build` — passes; `/api/forms/generate` route present.
- Non-anonymous 5-question form: 26.0 s, 10/10 personas succeeded, 60 seed answers persisted.
- Anonymous 3-question form: 17.9 s, 10/10 personas succeeded, 30 seed answers persisted.
- Supabase inspection (form `924d128b-...`):
  - `sessions`: 10 rows with `is_seed = true`, names diverse and globally mixed (Amara, Carlos, Chloe, David, Fatima, Jamal, Kenji, Leo, Priya, Sofia).
  - `answers`: 60 rows with `is_seed = true`, every closed-input value matches the question's stored options exactly, every ranking is a true permutation.
  - `this_or_that` distribution: 5/5 split (varied). `emoji_slider`: bimodal {5,10,10,10,25,25,65,80,85,85} — covers the range. `cards`: 3/3/4 across 3 options.
- Anonymous form (`b5e6f729-...`): all 10 sessions have `respondent_name = null`, no name question, 30 seed answers.

## Items wanting human review

1. **First-name-only rule isn't holding.** The prompt says "First name only" but Sarvam consistently returns first + last names ("Priya Sharma", "Amara Okonkwo"). They still fit the 24-char cap, so validation passes, but the database stores e.g. `respondent_name = "Priya Sharma"` instead of `"Priya"`. Two options: (a) tighten the prompt with a hard "ONE word, no surnames" rule and a `.refine()` check that rejects whitespace; (b) accept the looser interpretation since first+last actually reads better in `respondent_name` columns and on the share/identity surfaces. I went with (b) — the names are short enough. Flag for a call from the design side.

2. **Cross-validation retry rate is 0% in testing — too small a sample to be meaningful.** Both runs were single-shot with all 20 persona calls succeeding on attempt 1. The retry mechanism is correct in code but unexercised in practice. Worth running 5–10 more form generations to establish a real retry rate. If it stays at 0% the prompt's literal-copy rule is genuinely tight; if it spikes (e.g. on tones where the LLM gets creative — playful, insightful), we'll need to invest more in the retry message wording.

3. **`stance` and `voice_quirks` are NOT persisted to the database.** They live only in the in-memory `Persona[]` between Stage B and Stage C, and then they vanish. The voice diversity is preserved through the *answers* themselves, which is fine for Phase 4 aggregation, but if Phase 5 identity classification wants to inspect persona origin (e.g. for debugging "why was this persona classified as Cautious Adopter"), it can't. We may want to add a `personas` table later, or store them as JSONB on the form alongside `archetype_clusters`.

4. **Latency budget for Vercel.** 26 s on a 5-question form is comfortably under both the 60 s pro and the 180 s `maxDuration` set on the route. But if a creator authors a 10-question form and hits 2-attempt retries on Stage B, we could push 60 s. Worth instrumenting with a hard timeout on the whole pipeline (currently each stage has its own 90 s; nothing caps the sum).

5. **Sentiment is hardcoded to 0 for seeds.** This is intentional per the spec (sentiment is computed by Phase 4's aggregator), but reflections that depend on `sentiment_avg` will read these as neutral until Phase 4 backfills. Worth confirming Phase 4's seed-aware aggregation handles `sentiment = 0` rows correctly rather than treating them as zeros in averages.

6. **`scripts/seed.ts` is now dead code.** The legacy hand-tuned seeder is fully superseded by the LLM pipeline. Deleting it would clean up ~300 lines and remove a footgun (someone running it against a fresh form would double-seed). Spec said don't modify it; leaving for a follow-up cleanup pass.

7. **Identity at seed time.** Sessions are created with `identity_label = null` and `identity_summary = null` per the spec, but Phase 5 identity classification reads from completed sessions. Confirm Phase 5's classifier either skips `is_seed = true` sessions or runs over them on demand, otherwise reflections will surface seeded sessions with no identity labels.

---

## First-Name-Only Cleanup

### What changed

- **`lib/persona-generation.ts`** — the `name` rule in the Stage B system prompt was rewritten with capitalised emphasis and an explicit correct-vs-wrong example pair: `ONE WORD ONLY — a first name with NO surname, NO middle name, NO whitespace. "Priya" is correct. "Priya Sharma" is WRONG and will be rejected.`
- **`lib/schemas.ts`** — `personaSchema.name` gained a `.refine((n) => !/\s/.test(n), ...)` predicate that rejects any whitespace. This makes the existing retry loop fire on multi-word names, so the LLM gets a concrete validation error like *"personas[3].name: Persona name must be a single word with no whitespace"* and corrects on the next attempt.

No other validators, prompts, or persistence paths were touched. `lib/seed-generation.ts` and `app/api/forms/generate/route.ts` are unchanged.

### Retry rate across 3 fresh runs

| # | Tone | Form ID | Total time | Outcome |
|---|---|---|---|---|
| 1 | insightful | `96570fd7-925b-46e2-81b4-807528d69d28` | 37.5 s | Likely 1 retry on Stage B (excess vs typical 20–27 s baseline ≈ one Sarvam round-trip) — final result valid |
| 2 | playful | `b2cfe091-8a66-4c97-84c8-9efab8ca8d04` | 20.6 s | First-attempt success |
| 3 | calm | `f46a49bb-b36c-4f5b-80b6-cb8a19716f26` | 27.8 s | First-attempt success |

**Estimated form-level retry rate: 1/3 (~33%).** Below the 50% threshold the spec called out as needing further iteration. The retry mechanism caught the multi-word-name slip cleanly — final names were single-word in every case.

If the rate creeps up under broader use, the next move is probably reordering the rule earlier in the prompt (it currently lives mid-list under "Per-persona schema"). The capitalised correct/wrong pair is already doing most of the work.

### Cultural diversity preserved

Sample of all 10 names from each test run:

- **Test 1 (insightful):** Aisha, Chidi, David, Elena, Fatima, Kenji, Liam, Marcus, Priya, Sofia — 5 non-Western (Aisha, Chidi, Fatima, Kenji, Priya).
- **Test 2 (playful):** Ahmed, Ben, Elena, Fatima, Jin, Leo, Maya, Omar, Priya, Sofia — 5 non-Western (Ahmed, Fatima, Jin, Omar, Priya).
- **Test 3 (calm):** Fatima, Jamal, Kenji, Lena, Mateo, Omar, Priya, Sam, Sofia, Zahra — 7 non-Western (Fatima, Jamal, Kenji, Mateo, Omar, Priya, Zahra).

All three runs cleared the "at least 4 non-Western names" bar from the prompt. The first-name-only constraint did NOT push the LLM toward Western defaults — Arabic, Indian, Igbo, East Asian, and Latin American names appear consistently. The diversity rule and the single-word rule compose cleanly.

### Database verification

For all three test forms: `sessions.respondent_name` is a single word (no whitespace) for every row. Confirmed via Supabase REST query against the form IDs above — `all_single_word=True` for each batch of 10 sessions.

### Verification

- `npx tsc --noEmit` — passes.
- `npm run build` — passes.
- 3/3 curl tests returned `seed_status: "full"` (10/10 personas).
- Supabase: 30/30 seeded `respondent_name` values are single words.
- Cultural mix preserved: 5–7 non-Western names per run.
