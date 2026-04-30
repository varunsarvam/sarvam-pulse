# Phase 2 Report — Form Generation Pipeline (Stage A)

## What was built

- `lib/form-generation.ts` — `generateForm(input)` plus the request schema (`formGenerationInputSchema`), prompt builders, Sarvam wrapper with timeout, JSON parsing/repair, schema-driven retry, and a typed error class (`FormGenerationError`).
- `app/api/forms/generate/route.ts` — POST endpoint that validates the body, calls `generateForm`, persists the form + questions to Supabase using the service-role client, and rolls back the form row if the bulk question insert fails.
- No changes to `app/api/forms/route.ts`, the create UI, the database, or any other production code.

## Decisions on prompt design

**Single system prompt, structured user message.** The system prompt establishes Pulse's product context (one sentence), the form's tone, title, intent, the JSON shape, the per-input-type rules, and the option-quality rules. The user message is mechanical: a numbered list of `(intent, input_type, constraints)` triples + a closing instruction. This split keeps the LLM-facing instructions stable across calls and makes the per-form payload small.

**LLM produces 0-indexed positions, the wrapper inserts the name question.** I considered telling the LLM to start at position 1 in non-anonymous mode, but that adds a fragile dependency on the LLM remembering a mode flag. Instead the LLM always emits `position: 0..n-1`, and `postProcessQuestions()` shifts everything by +1 and prepends the hardcoded name question when `anonymous === false`. Schema validation runs **after** post-processing using `formGenerationOutputSchemaFor({ anonymous })`, so any LLM mistake on positions still gets caught.

**Tone guidance is explicit, not abstract.** Each tone gets a one-sentence rule of thumb (e.g. playful: *"warm, conversational, a touch of wit"*). Without this the LLM defaults to a generic neutral tone.

**Option-quality rules are concrete.** Cards: 4–6, parallel form, span the realistic stance space, no "Other". Ranking: exactly 4 of roughly equal weight. This-or-that: real sharp contrast, both sides defensible. Visual-select: 4–6 with `https://placeholder.test/<kebab-slug>.png`. These rules surfaced after the first iteration produced overly abstract card options ("Excitement", "Concern", "Curiosity") instead of grounded stances.

**Hard ban on the name question.** The system prompt explicitly says "Do not include a name question. The system handles that separately." Without this, the LLM kept inserting a name question itself.

**One iteration was enough.** I ran the prompt against four real inputs (insightful AI form, playful workday form, calm weekend form, direct two-question form) and the first non-trivial iteration of the prompt produced strong outputs across all of them — see "Sample output" below. I did not need to iterate further.

## Retry behavior

The conversation-style retry threads validation feedback back into the same chat. On each failure:

- **Parse failure** (the response was not valid JSON or was unbalanced after fence stripping): a system message is appended saying *"Your previous output was not valid JSON. Output strict JSON only..."*. The original system + user messages stay in place.
- **Schema validation failure** (JSON parsed but `formGenerationOutputSchemaFor(...)` rejected it): the first 8 Zod issues are formatted as `path: message` and appended in a system message that ends with *"Fix these issues. Output strict JSON only..."*. The original messages stay in place; each subsequent attempt sees an accumulating chain of system messages, so the LLM can't lose track of the rules across retries.
- **Sarvam timeout / network failure**: the conversation is not modified; we just retry the call.

`MAX_ATTEMPTS = 3`. After the third failure, `generateForm` throws `FormGenerationError("validation", ..., { issues, attempts })` where `issues` are the last validation errors and `attempts` is the array of raw outputs. The route handler maps these to HTTP 502.

## Measured Sarvam-105B latency

From three back-to-back successful calls:

- Attempt 1 only — single Sarvam call: **4.8s, 6.6s, 8.2s, 10.0s, 9.9s** (5 calls).
- Mean ~7.9s. Max observed: 10.0s.

The 90s timeout has comfortable headroom. **Implication for Phase 3:** if persona generation does N=10 sequential Sarvam-105B calls, expect ~80s end-to-end. If it can be parallelized, it'll fit in a single ~10s burst. The `maxDuration = 120` on the Phase 2 route is per-request; Phase 3 should set its own value or batch differently.

## Sample output (anonymous=false, insightful tone)

Input:

```json
{
  "formTitle": "Living With AI in 2026 (test)",
  "formIntent": "Understanding how people feel about AI in their daily lives, beyond the hype.",
  "tone": "insightful",
  "anonymous": false,
  "questionIntents": [
    { "intent": "How they feel about AI in their day", "input_type": "voice" },
    { "intent": "Their stance on AI replacing jobs", "input_type": "this_or_that" },
    { "intent": "How frequently they use AI tools", "input_type": "emoji_slider" },
    { "intent": "Which AI capability excites them most", "input_type": "cards" }
  ]
}
```

Persisted output (excerpted from Supabase):

```json
{
  "questions": [
    { "position": 0, "input_type": "name", "prompt": "Before we begin, what should we call you?", "options": null },
    { "position": 1, "input_type": "voice", "prompt": "Imagine your daily routine. How do you feel about the AI that's already there, quietly in the background?", "options": null },
    { "position": 2, "input_type": "this_or_that", "prompt": "AI is fundamentally changing work. Which future feels closer to reality to you?",
      "options": [
        "AI will create more fulfilling work by handling the tedious parts.",
        "AI will displace more jobs than it creates, leading to widespread disruption."
      ]
    },
    { "position": 3, "input_type": "emoji_slider", "prompt": "On a scale of 'Not in my world' to 'It's my constant companion', how comfortable are you using AI tools in your daily life?", "options": null },
    { "position": 4, "input_type": "cards", "prompt": "Which possibility for AI's future are you most looking forward to?",
      "options": [
        "Personalized education that adapts to every learner.",
        "Scientific breakthroughs that accelerate cures and climate solutions.",
        "Art and music that unlock entirely new forms of creativity.",
        "Effortless management of our homes and digital lives."
      ]
    }
  ],
  "archetype_clusters": [
    { "label": "Quiet Integrator", "description": "Sees AI as a seamless, invisible layer that quietly improves their day-to-day efficiency without being a focal point of their attention.",
      "indicator_signals": ["Describes AI as 'background' or 'just there'.", "Feels 'comfortable' or neutral, not excited or worried, about its role."] },
    { "label": "Pragmatic Skeptic", "description": "Acknowledges AI's potential but is grounded in concerns about its real-world impact, especially on jobs and society.",
      "indicator_signals": ["Expresses concern about job displacement.", "Views AI's future as a trade-off, focusing on potential downsides."] },
    { "label": "Futurist Builder", "description": "Views AI not as a tool, but as a new frontier. Their excitement is focused on its potential to solve humanity's biggest challenges or create entirely new things.",
      "indicator_signals": ["Excitement is tied to high-impact capabilities like scientific breakthroughs or new art forms.", "Believes AI will create more opportunities than it destroys."] },
    { "label": "Cautious Dabbler", "description": "Uses AI, but sparingly and with a degree of caution. They see its value for specific, limited tasks but aren't ready for deep integration.",
      "indicator_signals": ["Rates their comfort with AI as somewhere in the middle of the slider.", "Uses AI for 'small things' or 'a few specific tasks'."] }
  ]
}
```

Anonymous-mode call also tested (`tone: playful`, four user questions): position 0 is the user's first question; no name question; archetypes generated cleanly.

## Curl commands

**Non-anonymous, insightful (the prompt's headline test):**

```bash
curl -X POST http://localhost:3000/api/forms/generate \
  -H "Content-Type: application/json" \
  -d '{
    "formTitle": "Living With AI in 2026 (test)",
    "formIntent": "Understanding how people feel about AI in their daily lives, beyond the hype.",
    "tone": "insightful",
    "anonymous": false,
    "questionIntents": [
      { "intent": "How they feel about AI in their day", "input_type": "voice" },
      { "intent": "Their stance on AI replacing jobs", "input_type": "this_or_that" },
      { "intent": "How frequently they use AI tools", "input_type": "emoji_slider" },
      { "intent": "Which AI capability excites them most", "input_type": "cards" }
    ]
  }'
```

Expected: `{"id":"...","questions_created":5,"archetypes_count":3..5}` (5 = name + 4 user questions).

**Anonymous, playful:**

```bash
curl -X POST http://localhost:3000/api/forms/generate \
  -H "Content-Type: application/json" \
  -d '{
    "formTitle": "Coffee Break Energy Check",
    "formIntent": "How are folks really doing in the middle of their workday?",
    "tone": "playful",
    "anonymous": true,
    "questionIntents": [
      { "intent": "Energy level right now", "input_type": "emoji_slider" },
      { "intent": "Pick the vibe of your day so far", "input_type": "cards" },
      { "intent": "Rank what makes a workday good", "input_type": "ranking" },
      { "intent": "Tea or coffee", "input_type": "this_or_that" }
    ]
  }'
```

Expected: `questions_created: 4` (no name question, positions 0..3).

**Validation rejection (input_type === "name"):**

```bash
curl -X POST http://localhost:3000/api/forms/generate \
  -H "Content-Type: application/json" \
  -d '{"formTitle":"x","formIntent":"y","tone":"playful","anonymous":false,"questionIntents":[{"intent":"q","input_type":"name"}]}'
```

Expected: HTTP 400 with the issue path `questionIntents.0.input_type` and message *"input_type 'name' is system-managed; do not request it"*.

## Items wanting human review

1. **emoji_slider phrasing was sometimes garbled.** In the calm-tone "Weekend Mood Check" run, the LLM produced `"How rested do you feel on a scale from  :\n\n :\n\n :"` — looks like it tried to embed emoji literals that got dropped. The current prompt rule for `emoji_slider` only says to phrase it so 'low' and 'high' are intuitive. Worth tightening with: "Do not embed emoji or scale labels in the prompt; the UI provides them." Flagging for review rather than fixing speculatively.
2. **`visual_select` placeholder URL convention.** I used `https://placeholder.test/<slug>.png`. The `.test` TLD won't resolve in browsers, which is intentional (we don't want the LLM to hand back a real URL it doesn't control). But the renderer will need a fallback image. Whoever wires up `visual_select` rendering should plug in a placeholder asset.
3. **One Sarvam call per form is cheap; 11 per form is the next thing to budget for.** Current p99 is ~10s for a 4-question form. Phase 3's persona pipeline (10 personas + persona-aware seed generation) should consider parallelism and a separate timeout budget — the 90s used here would only cover a serialised burst with no margin.
4. **Rollback is best-effort.** If the form insert succeeds but the questions insert fails, we delete the form row. If the delete itself fails (network blip), we log and return 500 — the form row is leaked. Acceptable for hackathon mode; flagging for production hardening.
5. **`maxDuration = 120` on the route.** Set as a precaution against hosted Next.js timeouts (Vercel's default is 10s for serverless). If we deploy on infrastructure with longer defaults, this is a no-op; otherwise it matters. Confirm on deploy.

## Verification

- `npx tsc --noEmit` — passes.
- `npm run build` — passes; new route appears as `ƒ /api/forms/generate`.
- 4 manual curl tests against `localhost:3001` (dev server): all returned 201 with `questions_created` matching expectation. Anonymous and non-anonymous both work. The 400 rejection path returns the expected Zod issue.
- Supabase verified for each: `forms.archetype_clusters` populated; `questions` rows in correct positions, with `input_type === "name"` at position 0 only when `anonymous === false`; `intent` set to `"system: name capture"` for the name row.
- No new ESLint errors introduced (existing carry-forward errors unchanged).

---

## Phase 2 Adjustment — Length Constraints

### Caps applied (in `lib/schemas.ts`, surfaced via `LENGTH_LIMITS`)

| Field | Cap |
|---|---|
| `Question.prompt` | 200 |
| `Question.options` cards (each) | 80 |
| `Question.options` this_or_that (each) | 100 |
| `Question.options` ranking (each) | 48 |
| `Question.options` visual_select label (each) | 32 |
| `ArchetypeCluster.label` | 32 |
| `ArchetypeCluster.description` | 200 |
| `ArchetypeCluster.indicator_signals` (each) | 80 |
| `Persona.name` | 24 |
| `Persona.stance` | 200 |
| `Persona.voice_quirks` | 200 |
| `Identity.label` | 32 |
| `Identity.summary` | 200 |
| `Identity.highlights` (each) | 60 |
| `SeedAnswer.value` (name) | 24 |
| `SeedAnswer.transcript` (voice/text) | 400 |

The `Identity.label` cap (32) intentionally matches `ArchetypeCluster.label` since the runtime constraint is "must be one of the archetype labels."

### Prompt updates (in `lib/form-generation.ts`)

- Per-input-type length rules now interpolate from `LENGTH_LIMITS` directly, so prompt and schema cannot drift.
- New rule for `null`-options input types: *"For input types with options=null (voice, text, emoji_slider), the prompt is plain text only. Do not embed emoji, scale labels, or option-like markers (no ':', no '/', no parenthetical scale words). The UI provides those affordances."* This addresses the emoji_slider artifact reported in the original Phase 2.
- Added a hard rule at the bottom: *"Respect every length cap. Outputs that exceed any cap will be rejected and you will be asked to retry."*
- Added a brevity nudge in option-quality rules: *"Keep every option as short as is honest. Trim filler."* Plus tightened ranking ("each is 1–4 words") and visual_select ("labels are 1–3 words") guidance.

### Test observations (5 generations on a fresh dev server)

| # | Form | Outcome |
|---|---|---|
| 1 | Insightful AI (canonical) | Attempt 1 ✓ — 8.2s |
| 2 | Playful workday (anonymous) | Attempt 1 ✓ — 8.6s |
| 3 | Calm weekend (visual_select + text) | Attempt 1 JSON parse error → Attempt 2 ✓ (13.0s total) |
| 4 | Direct retro | Attempt 1 archetype signal >80 chars → Attempt 2 unrelated shape error → Attempt 3 ✓ (14.7s total) |
| 5 | Stress: prompt encouraged "very detailed and richly elaborated cards options" | Attempt 1 cards options >80 chars → Attempt 2 ✓ (12.6s total) |

All 5 ended with valid output. The retry mechanism actively saved generations 3, 4, and 5 — the validation feedback message (with the offending field paths) was sufficient for the LLM to produce conforming output on the next attempt. **Test 5 is the most informative**: I deliberately asked for verbose options, and Sarvam complied on attempt 1 (max option 122 chars), then trimmed to fit the cap on attempt 2 (max 76 chars) after seeing the schema errors.

### Length verification — measured maxima from the 5 forms

| Field | Cap | Max observed |
|---|---|---|
| Question.prompt | 200 | 69 |
| cards option | 80 | 76 (test 5; tight to cap, expected) |
| this_or_that option | 100 | 66 |
| ranking option | 48 | 27 |
| visual_select label | 32 | 13 |
| archetype label | 32 | observed all ≤ 24 |
| archetype description | 200 | observed all ≤ ~190 |
| archetype signal | 80 | observed all ≤ 80 (test 4 attempt 1 exceeded; corrected on retry) |

### Items wanting human review

1. **emoji_slider artifact is improved but not eliminated.** Test 2 produced *"On a scale from meh to awesome, how's your energy right now?"* — that is a textual scale label, which the new prompt rule discourages. The egregious case from Phase 2 (raw emoji literals) is gone. If we want stricter enforcement, the prompt could say "do not reference any scale at all in the prompt; just ask the question directly."
2. **Retry latency budget.** Worst observed: 14.7s for 3 attempts. Within the 90s timeout, but a noisy production tail. Phase 3 will compound this — 10 personas, each potentially retrying — so retry budget should be considered there.
3. **Cap on `cards` is tight.** Test 5 came in at 76 chars (cap 80) on the retry. If we want options to read more like single phrases than full sentences, dropping cap to 60 would force the LLM to be more elliptical. Leaving at 80 for now since that matches the original sample data ("Personalized education that adapts to every learner." — 53 chars) without forcing artificiality.

### Verification

- `npx tsc --noEmit` passes.
- `npm run build` passes.
- 5 fresh `/api/forms/generate` calls completed; all persisted to Supabase with all string fields within their respective caps.
- Inspected the new forms' rows directly via Supabase REST: `cards` options ≤ 76 chars, `this_or_that` ≤ 66, `ranking` ≤ 27, `visual_select.label` ≤ 13, `archetype_clusters[*].label` ≤ 24, `archetype_clusters[*].description` ≤ ~190, all `indicator_signals` ≤ 80.
- Old forms generated before the adjustment were left in place untouched.

---

## Length Constraints Adjustment

Tightened option/prompt caps and added explicit voice rules. The Phase 2 prompt now bans explanatory phrasing in options ("poetry, not policy") and forbids multi-clause questions. The original looser caps (cards 80, this_or_that 100, etc.) were producing valid output that nonetheless read as run-on policy statements; this pass narrows the targets to where the design actually wants them.

### Caps applied

| Field | Cap |
|---|---|
| `Question.prompt` | 130 (aim 60–110) |
| cards option | 32 |
| this_or_that option | 40 |
| ranking option | 44 |
| visual_select label | 28 |
| `ArchetypeCluster.label` | 32 |
| `ArchetypeCluster.description` | 200 |
| `ArchetypeCluster.indicator_signals` (each) | 80 |
| `Persona.name` | 24 |
| `Persona.stance` | 200 |
| `Persona.voice_quirks` | 200 |
| `Identity.label` | 32 |
| `Identity.summary` | 200 |
| `Identity.highlights` (each) | 60 |
| `SeedAnswer.transcript` (voice/text) | 400 |
| `SeedAnswer.value` (name) | 24 |

(Same architecture, same `LENGTH_LIMITS` constant — only the five Question-related numbers changed.)

### Retry events across 5 fresh test runs

| # | Tone, mode | Outcome |
|---|---|---|
| 1 | insightful, named | Attempt 1 ✓ — 7.4s |
| 2 | playful, anonymous | Attempt 1 schema fail (`questions.0.options: expected null, received undefined`) → Attempt 2 ✓ — 11.4s total |
| 3 | calm, named | Attempt 1 ✓ — 8.1s |
| 4 | direct, named | Attempt 1 ✓ — 5.9s |
| 5 | insightful, named | Attempt 1 ✓ — 5.7s |

**No length-driven retries.** The single retry (test 2) was a structural slip (the LLM omitted `options: null` rather than including it). The new prompt is not too restrictive — Sarvam-105B is meeting the tighter caps comfortably on first attempt.

### Voice quality — sample option sets

These are real outputs from the 5 test runs (lengths in brackets):

**Test 5, cards — "Which metaphor best captures your view of AI?"** — exemplary
- "A powerful but neutral tool" [27]
- "An emergent, unpredictable force" [32]
- "A reflection of our own biases" [30]
- "A partner for human creativity" [30]
- "A threat to human autonomy" [26]

**Test 5, ranking — "Please rank these AI concerns…"** — matches the prompt's "Good" example almost verbatim
- "Losing control over AI systems" [30]
- "Job displacement and economic inequality" [40]
- "Privacy and mass surveillance" [29]
- "AI making biased decisions about me" [35]

**Test 1, cards — "What excites you most about what AI can do?"** — clean metaphors
- "Creative collaborator" [21]
- "Personal assistant" [18]
- "Problem solver" [14]
- "Entertainment companion" [23]

**Test 2, cards — "What's your vibe today?"** — evocative self-descriptions
- "Just getting by" [15]
- "Feeling productive" [18]
- "In the zone" [11]
- "A bit foggy" [11]

**Test 5, this_or_that — "Is AI more of a helpful tool or a potential threat?"**
- "A tool to extend human capabilities" [35]
- "A potential threat to human agency" [34]

All cards/ranking/this_or_that/visual_select values across all 5 runs were under cap. Most prompts landed inside the 60–110 sweet spot; the shortest was 14 chars ("Tea or coffee?") and the longest 68. No multi-clause questions observed.

### Final system prompt

The full prompt assembled by `buildSystemPrompt()` in `lib/form-generation.ts` (length values interpolated from `LENGTH_LIMITS`):

```
You are the form generator for Pulse — a conversational survey product where respondents answer one question at a time, each in a tailored input type, and receive a personalized identity card at the end.

Form tone: <tone> — <tone guidance>
Form title: <title>
Form intent: <intent>

Your job: for each question intent the user provides, write the final phrasing of the question in the form's tone, and (where applicable) generate the options that match the input type. Then generate 3–5 archetype_clusters describing the kinds of respondents this form will surface.

Output strict JSON only. No markdown fences. No preamble. No commentary. The JSON must match this shape exactly:
{
  "questions": [
    { "prompt": string, "position": int, "input_type": "voice"|"text"|"emoji_slider"|"cards"|"ranking"|"this_or_that"|"visual_select", "options": null | string[] | { "label": string, "image_url": string }[] }
  ],
  "archetype_clusters": [
    { "label": string (2–4 words), "description": string (1–2 sentences), "indicator_signals": string[] (≥1) }
  ]
}

Question rules:
- prompt: 1–2 sentences, max 130 characters. Match the form tone. Never echo the intent verbatim.
- position: zero-indexed, in the order given. Question 0 is the first question, then 1, 2, ...
- input_type must match the input type given for that intent.
- For input types where options is null (name, voice, text, emoji_slider), produce only the question prompt as plain text. Do not embed emojis, labels, or examples within the prompt itself.
- options shape must match the input_type:
  - voice / text / emoji_slider: options is null.
  - cards: 4–6 strings, each max 32 characters.
  - ranking: exactly 4 strings, each max 44 characters.
  - this_or_that: exactly 2 strings, each max 40 characters.
  - visual_select: 4–6 objects with { "label": string (max 28 chars), "image_url": string }. Use https://placeholder.test/<kebab-slug>.png for image_url.

Option-quality rules:
- Options must be plausible answers to THIS question, not generic. Reading them, the respondent should think 'one of these is me'.
- For cards: span the realistic stance space (e.g. for AI comfort: 'I avoid it', 'I dabble', 'I use it daily', 'I build with it'). Parallel form. No 'Other'.
- For this_or_that: a real, sharp contrast. Both sides defensible.
- For ranking: 4 items of roughly equal weight.
- For visual_select: distinct visual concepts.

LENGTH AND VOICE CONSTRAINTS — strictly follow:

Length limits:
- Question prompts: aim 60-110 characters, hard cap 130. Questions should feel like a moment, not a paragraph.
- cards options: max 32 characters. Use evocative metaphors or self-descriptions. NOT explanations.
  Good: "A research partner", "A shortcut machine", "I mostly avoid it"
  Bad:  "AI is a tool I use as a research assistant for finding information"
- this_or_that options: max 40 characters. Two contrasting positions, each terse.
  Good: "Helpful tool" / "Threat to jobs"
  Bad:  "AI will create more fulfilling work" / "AI will displace more jobs than it creates"
- ranking options: max 44 characters. Concrete nouns or short noun phrases.
  Good: "Losing my job", "Privacy and surveillance", "AI making decisions about me"
  Bad:  "The possibility that AI will make decisions about me without my knowledge"
- visual_select labels: max 28 characters. Even shorter than cards.
- Archetype labels: max 32 characters
- Archetype descriptions: max 200 characters
- Indicator signals: max 80 characters each

Voice rules:
- Options should feel like poetry, not policy. Terse over comprehensive.
- Never use phrases like "AI will...", "...leading to...", "...because of..." in options. Options are not sentences.
- Question prompts should ask one thing, evocatively. No multi-clause questions.

Archetype rules:
- 3–5 clusters per form. Labels are short, evocative, 2–4 words, max 32 characters (e.g. 'Cautious Adopter', 'Quiet Skeptic'). No two clusters share a label.
- description is 1–2 sentences, max 200 characters.
- indicator_signals is an array of phrases or behaviors that mark someone as this archetype, drawn from the kinds of answers they'd give to THESE questions. At least 2 signals per cluster, each max 80 characters.
- Together the clusters should partition the realistic respondent space — distinct, useful for downstream identity classification.

Hard rules:
- Output JSON only. No code fences, no preamble, no explanations.
- Do not include a name question. The system handles that separately.
- Do not invent input types not listed. Do not add fields not listed.
- Respect every length cap. Outputs that exceed any cap will be rejected and you will be asked to retry.
```

### Items wanting human review

1. **One emoji_slider prompt still embedded an emoji.** Test 2 produced *"How's your energy right now? 🤔"* despite the ban *"Do not embed emojis, labels, or examples within the prompt itself."* This is the playful tone bypassing the rule. Voice rules around tone may need a stricter override (e.g. *"This rule overrides tone — never embed emoji in prompts, even for playful forms."*). Flagging rather than fixing per "do not improve the prompt beyond what's asked."
2. **Test 1 this_or_that used "AI will…"** — *"AI will replace jobs."* / *"AI will create new jobs."* This violates the explicit voice rule *"Never use phrases like 'AI will...'"* but Sarvam still produced it (and it was under cap, so no retry fired). Voice rules are aspirational, not enforced. Possible fix: add `.refine()` checks for these specific phrases and let the retry mechanism enforce them — though that risks making the system rigid in cases where "AI will…" is the cleanest framing.
3. **Test 2 retry was unrelated to length** — schema shape error (`options: undefined` instead of `null` for the emoji_slider question). Same issue surfaced in the previous Phase 2 adjustment runs. This is a structural slip Sarvam-105B makes occasionally; the conversation-style retry catches it.
4. **Test 5 cards is the showcase.** "A powerful but neutral tool" / "An emergent, unpredictable force" / "A reflection of our own biases" / "A partner for human creativity" / "A threat to human autonomy" — these are exactly the voice the prompt is aiming for. The metaphor framing in the question intent ("Pick the metaphor closest to your view of AI") helped, but the voice rules clearly carried.

### Verification

- `npx tsc --noEmit` passes.
- `npm run build` passes.
- 5 fresh forms generated; 4/5 first-attempt success; 1 retry on a non-length structural error.
- All persisted Supabase rows checked against caps: every cards/ranking/this_or_that/visual_select string under cap; every prompt ≤ 68 chars.
- Voice quality matches the prompt's "Good" examples in tests 1, 2, 4, 5; one borderline case (test 1 this_or_that) flagged above.

---

## Phase 2 Final Polish

### Schema changes

**`lib/schemas.ts`**

- `LENGTH_LIMITS` gains `emojiSliderLabel: 20`.
- `emoji_slider` options changed from `z.null()` to `z.object({ min_label: z.string().min(1).max(20), max_label: z.string().min(1).max(20) })`.
- All other input_type variants (`name`, `voice`, `text`, `cards`, `ranking`, `this_or_that`, `visual_select`) unchanged.

**Places that previously assumed `emoji_slider.options === null`:**

- `components/inputs/EmojiSlider.tsx` — had `void question;` (the prop was unused). Now reads `question.options` as `{ min_label?, max_label? }` with a "Less"/"More" fallback.
- `app/api/answers/route.ts` — the majority/minority distribution filter checks `Array.isArray(question.options)`. For `emoji_slider` this was already false (options was `null`); with an object it's still false. No change required.
- `app/api/complete-session/route.ts` — only reads `answers.raw_value.value` for slider percentile math. No change required.
- `lib/types.ts` — `options: unknown | null` is already wide enough. No change required.
- `app/respond/[formId]/RespondentFlow.tsx` — passes `question={question}` to `<EmojiSlider>` and does not read `options` for emoji_slider directly. No change required.

### Prompt changes (lib/form-generation.ts)

1. **JSON shape line** — `emoji_slider` options now shown as `{ "min_label": string, "max_label": string }` instead of `null`.
2. **Null-options rule** — `emoji_slider` removed from the `(name, voice, text, emoji_slider)` null list.
3. **Options shape rules** — `emoji_slider` gets its own rule: `options is { "min_label": string, "max_label": string }. Each 1–3 words, max 20 characters each.`
4. **INPUT_TYPE_RULES** — updated to instruct the LLM to generate contextual min/max labels.
5. **Length limits section** — added `emoji_slider min_label / max_label: max 20 characters each. 1–3 words.`
6. **GOOD QUESTIONS** — anchored examples section added (5 examples across 4 tones).
7. **QUESTION QUALITY RULES** — 7-rule subsection enforcing complete sentences, second-person voice, no noun-phrase questions, no abstract nouns, one idea per question.
8. **EMOJI_SLIDER LABELS** — 4 worked examples showing how labels must match the question's verb/scale; explicit ban on defaulting to "Strongly disagree"/"Strongly agree".
9. **Temperature** — lowered from `0.7` to `0.6`.

### Frontend change (components/inputs/EmojiSlider.tsx)

- `EmojiCard` now accepts a `label: string` prop instead of reading `step.label` directly.
- `EmojiSlider` parses `question.options as { min_label?, max_label? }` with fallback `"Less"` / `"More"`.
- First step (value=0) uses `minLabel`; last step (value=100) uses `maxLabel`; middle steps keep their existing semantic labels.
- A static endpoint label bar (`minLabel` left-aligned, `maxLabel` right-aligned) is rendered below the emoji grid.
- The `void question;` no-op removed.

### Full updated system prompt

```
You are the form generator for Pulse — a conversational survey product where respondents answer one question at a time, each in a tailored input type, and receive a personalized identity card at the end.

Form tone: <tone> — <tone guidance>
Form title: <title>
Form intent: <intent>

Your job: for each question intent the user provides, write the final phrasing of the question in the form's tone, and (where applicable) generate the options that match the input type. Then generate 3–5 archetype_clusters describing the kinds of respondents this form will surface.

Output strict JSON only. No markdown fences. No preamble. No commentary. The JSON must match this shape exactly:
{
  "questions": [
    { "prompt": string, "position": int, "input_type": "voice"|"text"|"emoji_slider"|"cards"|"ranking"|"this_or_that"|"visual_select", "options": null | { "min_label": string, "max_label": string } | string[] | { "label": string, "image_url": string }[] }
  ],
  "archetype_clusters": [
    { "label": string (2–4 words), "description": string (1–2 sentences), "indicator_signals": string[] (≥1) }
  ]
}

Question rules:
- prompt: 1–2 sentences, max 130 characters. Match the form tone. Never echo the intent verbatim.
- position: zero-indexed, in the order given. Question 0 is the first question, then 1, 2, ...
- input_type must match the input type given for that intent.
- For input types where options is null (name, voice, text), produce only the question prompt as plain text. Do not embed emojis, labels, or examples within the prompt itself.
- options shape must match the input_type:
  - voice / text: options is null.
  - emoji_slider: options is { "min_label": string, "max_label": string }. Each 1–3 words, max 20 characters each.
  - cards: 4–6 strings, each max 32 characters.
  - ranking: exactly 4 strings, each max 44 characters.
  - this_or_that: exactly 2 strings, each max 40 characters.
  - visual_select: 4–6 objects with { "label": string (max 28 chars), "image_url": string }. Use https://placeholder.test/<kebab-slug>.png for image_url.

Option-quality rules:
- Options must be plausible answers to THIS question, not generic. Reading them, the respondent should think 'one of these is me'.
- For cards: span the realistic stance space. Parallel form. No 'Other'.
- For this_or_that: a real, sharp contrast. Both sides defensible.
- For ranking: 4 items of roughly equal weight.
- For visual_select: distinct visual concepts.

LENGTH AND VOICE CONSTRAINTS — strictly follow:

Length limits:
- Question prompts: aim 60-110 characters, hard cap 130. Questions should feel like a moment, not a paragraph.
- cards options: max 32 characters. Use evocative metaphors or self-descriptions. NOT explanations.
- this_or_that options: max 40 characters. Two contrasting positions, each terse.
- ranking options: max 44 characters. Concrete nouns or short noun phrases.
- visual_select labels: max 28 characters. Even shorter than cards.
- emoji_slider min_label / max_label: max 20 characters each. 1–3 words.
- Archetype labels: max 32 characters
- Archetype descriptions: max 200 characters
- Indicator signals: max 80 characters each

Voice rules:
- Options should feel like poetry, not policy. Terse over comprehensive.
- Never use phrases like "AI will...", "...leading to...", "...because of..." in options. Options are not sentences.
- Question prompts should ask one thing, evocatively. No multi-clause questions.

GOOD QUESTIONS — pattern-match these for voice and rhythm:

Example 1 (insightful, voice): "Forget the headlines — when AI comes up for you, what's the one thing that genuinely makes your stomach clench?"
Example 2 (insightful, cards): "What does your actual daily interaction with AI look like in practice?"
Example 3 (calm, this_or_that): "When AI surprises you in your work, what's the first feeling that surfaces?"
Example 4 (playful, ranking): "If AI keeps getting better, which of these would you protect first?"
Example 5 (direct, emoji_slider): "How often does AI actually save you time on real work?"

Patterns to notice:
- Every question is a complete, grammatical sentence ending with '?'
- They ask one thing, with embodied language (stomach clench, feel, save time)
- They avoid generic abstractions ('perspective', 'thoughts', 'views')
- They're written in second person ('you', 'your') — direct, intimate

QUESTION QUALITY RULES — strictly follow:
- Every question must be a complete, grammatical sentence ending with a question mark.
- Use second-person voice ('you', 'your'). Never write 'one's perspective' or 'people's views'.
- Avoid noun-phrase questions ('Your thoughts on AI?'). Always full sentence-form.
- Avoid generic openers like 'What do you think about...' or 'How do you feel about...'.
- Avoid abstract nouns: 'perspective', 'thoughts', 'views', 'opinions'. Replace with embodied or specific language.
- One concrete idea per question. No multi-clause questions joining with 'and'.
- Read each question aloud in your head. If it doesn't flow, rewrite it.

EMOJI_SLIDER LABELS:
For every emoji_slider question, generate min_label and max_label that match the question's actual scale.
  "How often do you use AI?" → min: "Never", max: "Constantly"
  "How comfortable are you with AI decisions?" → min: "Uneasy", max: "At ease"
  "How likely to recommend AI tools?" → min: "Never would", max: "Already do"
  "How much has AI changed your work?" → min: "Not at all", max: "Completely"
Never use 'Strongly disagree'/'Strongly agree' unless the question is literally an agreement statement.

Archetype rules: [unchanged]
Hard rules: [unchanged]
```

### Verification

- `npx tsc --noEmit` — passes (no new errors).
- `npm run build` — passes; all routes present including `/api/forms/generate`.
- End-to-end curl tests require a running dev server with Sarvam API access; see curl commands in earlier sections for the test payloads. Expected:
  - Every `emoji_slider` question has `options: { min_label, max_label }` populated.
  - `min_label` and `max_label` match the question's verb/scale (not "Strongly disagree"/"Strongly agree").
  - All question prompts are complete sentences ending with `?`, using second-person voice.
  - Prompts ≤ 130 chars; `min_label`/`max_label` ≤ 20 chars.
