# Pulse Intelligence-Layer Schemas

This document is the authoritative reference for the data contracts produced by the Pulse server-side LLM pipelines (Stages A–C and Phase 5 identity classification). The Zod source of truth is `lib/schemas.ts`. This file is the prose equivalent — readable by someone who has never seen Zod.

> **Phase scope.** Phase 1 only defines schemas, types, and this documentation. No API routes, prompts, LLM calls, or database changes. Database additions (`forms.archetype_clusters`, `forms.anonymous`, `is_seed` flags on `sessions` / `answers`) are scheduled for Phase 2.

## Length constraints

All free-text fields are capped to keep output within UI visual limits. The caps are centralised as the `LENGTH_LIMITS` constant in `lib/schemas.ts` so the LLM prompts (in `lib/form-generation.ts` and later phases) stay in lockstep with the Zod-enforced rules.

| Field | Max chars |
|---|---|
| `Question.prompt` | 130 |
| `Question.options` (cards, each) | 32 |
| `Question.options` (this_or_that, each) | 40 |
| `Question.options` (ranking, each) | 44 |
| `Question.options` (visual_select, label) | 28 |
| `Question.options` (emoji_slider, min_label) | 20 |
| `Question.options` (emoji_slider, max_label) | 20 |
| `ArchetypeCluster.label` | 32 |
| `ArchetypeCluster.description` | 200 |
| `ArchetypeCluster.indicator_signals` (each) | 80 |
| `Persona.name` | 24 |
| `Persona.stance` | 200 |
| `Persona.voice_quirks` | 200 |
| `Identity.label` | 32 (matches archetype label cap) |
| `Identity.summary` | 200 |
| `Identity.highlights` (each) | 60 |
| `SeedAnswer.value` (name) | 24 |
| `SeedAnswer.transcript` (voice/text) | 400 |

The cards/ranking/this_or_that/visual_select caps are tight by design — options should read as evocative phrases, not sentences. The Phase 2 prompt enforces this via voice rules ("options are not sentences"; "poetry not policy").

Outputs that exceed any cap fail Zod validation and trigger a retry with the validation issues threaded back into the LLM conversation.

---

## System-wide convention: the `name` question

Pulse always captures the respondent's name as **Q1** of every form. This convention is invisible to both the form creator and the respondent:

- The form creator never sees a name question in the `/create` UI. The form generation pipeline (Stage A) auto-inserts it.
- The respondent enters their name on the **SETUP** screen, before the question flow begins. The flow itself never re-prompts for it.
- The captured name is silently written as the answer to the Q1 (`input_type = "name"`) question, so the join (`answers ⨝ questions`) downstream stays uniform — every session has an answer for every question, including Q1.

Because of this, `name` is a **first-class input type** — not a special case bolted on. Specifically:

| Surface | Treatment |
|---|---|
| `Question.input_type` enum | Includes `"name"` |
| `Question.options` | `null` for name |
| `SeedResponse` answers | `{ input_type: "name", value: <persona's name> }` |
| Aggregations (Phase 4) | **Skip name questions.** Do not compute distribution, sentiment, clusters, or quotes for name. |
| Reflections | **Skip name questions.** No reflection card is shown for Q1. (Already true in the current pipeline; preserve the rule.) |
| Phrasing (`/api/phrase-question`) | Skip — name uses the hardcoded `NAME_QUESTION_PROMPT` constant. |

The phrasing for Q1 is a constant in the schema layer — see `NAME_QUESTION_PROMPT` in `lib/schemas.ts`. Stage A does not spend an LLM call generating this; the wording is identical across all forms.

---

## Planned database addition: `forms.anonymous`

A new column will be added to the `forms` table in Phase 2:

```sql
alter table forms add column anonymous boolean not null default false;
```

**Effect on the pipeline:**

- When `anonymous = false` (default): the name question is auto-inserted as Q1 (position 0). The SETUP screen captures the respondent's name. All the rules in the previous section apply.
- When `anonymous = true`: the form generation pipeline **skips** the name question. The first question is the creator's first question (position 0). The SETUP screen does not capture a name. `Identity.summary` and downstream personalization use a generic second person.

Schema-side, `formGenerationOutputSchemaFor({ anonymous })` is a factory that returns a schema appropriate for the form's mode. Both modes share the same TypeScript shape — only the Q1-is-name validation differs. Stage A's call site picks the correct variant based on the form's `anonymous` flag.

**Phase 1 does not add this column.** Only the schema/docs reference it for forward planning.

---

## Schemas

### 1. `ArchetypeCluster`

A named "kind of respondent" for a given form. 3–5 clusters per form.

**Produced:** Stage A (form generation), persisted on the form (target column: `forms.archetype_clusters jsonb`, added in Phase 2).

**Consumed:** Phase 5 identity classification, which matches a respondent's full answer pattern to one of the form's clusters.

**Fields:**

| Field | Type | Notes |
|---|---|---|
| `label` | `string` | 2–4 words, evocative, e.g. "Cautious Adopter". Globally unique within the form (enforced at insertion time). |
| `description` | `string` | 1–2 sentences describing the worldview/stance. |
| `indicator_signals` | `string[]` | Phrases or behaviours that mark someone as this archetype (≥ 1). Used as priors during identity classification. |

**Example (JSON):**

```json
{
  "label": "Cautious Adopter",
  "description": "Curious about AI but worried about its pace. Wants tools that help, not replace.",
  "indicator_signals": [
    "expresses anxiety about job loss",
    "tends to pick the cautious option in this_or_that",
    "uses phrases like 'I'm not sure' or 'maybe'"
  ]
}
```

---

### 2. `Question`

A fully-realized question stored in the `questions` table.

**Produced:** Stage A (form generation).

**Consumed:** the respondent flow (`/respond/[formId]`), Stage C seed-data generation, and the answers API.

The schema is a **discriminated union on `input_type`** so each variant pins down its `options` shape exactly.

**Common fields:**

| Field | Type | Notes |
|---|---|---|
| `prompt` | `string` | The text shown to the respondent. For `input_type = "name"`, this is `NAME_QUESTION_PROMPT`. |
| `position` | `int` (≥ 0) | Order within the form. The name question is position 0; the creator's questions begin at 1 (or at 0 if `anonymous = true`). |
| `input_type` | enum | One of `name | voice | text | emoji_slider | cards | ranking | this_or_that | visual_select`. |
| `options` | varies | Shape per `input_type`, see table below. |

**`options` shape per input type:**

| `input_type` | `options` | Constraints |
|---|---|---|
| `name` | `null` | — |
| `voice` | `null` | — |
| `text` | `null` | — |
| `emoji_slider` | `{ min_label: string; max_label: string }` | Each 1–3 words, max 20 chars. Must match the question's scale. |
| `cards` | `string[]` | min 2, max 8 |
| `ranking` | `string[]` | min 2, max 8 |
| `this_or_that` | `string[]` | exactly 2 |
| `visual_select` | `{ label: string; image_url: string }[]` | min 2, max 6 |

**Example (cards):**

```json
{
  "prompt": "Which best describes how you use AI today?",
  "position": 3,
  "input_type": "cards",
  "options": ["I avoid it", "I dabble", "I use it daily", "I build with it"]
}
```

**Example (name):**

```json
{
  "prompt": "What should I call you?",
  "position": 0,
  "input_type": "name",
  "options": null
}
```

---

### 3. `FormGenerationOutput`

The full output of Stage A — the LLM's structured response, validated strictly. Failure to validate triggers a retry.

**Produced:** Stage A.

**Consumed:** the persistence layer (writes `forms` row + bulk-inserts `questions`).

**Fields:**

| Field | Type | Notes |
|---|---|---|
| `questions` | `Question[]` | First element is the name question (input_type `name`, position 0) for non-anonymous forms; remaining are the creator's questions in order. |
| `archetype_clusters` | `ArchetypeCluster[]` | 3–5 clusters per form. Labels unique within the form. |

**Validation rules** (enforced via `superRefine` in the Zod schema):

1. `questions[0].input_type === "name"` and `questions[0].position === 0` — **non-anonymous mode only.**
2. For all `i`: `questions[i].position === i`. Positions must be contiguous, starting at 0, no gaps.
3. `archetype_clusters` labels are unique.

**Schema selection.** Use the factory:

```ts
import { formGenerationOutputSchemaFor } from "@/lib/schemas";

// Stage A — non-anonymous form (default):
const schema = formGenerationOutputSchemaFor({ anonymous: false });
const result = schema.parse(llmOutput);

// Stage A — anonymous form:
const schema = formGenerationOutputSchemaFor({ anonymous: true });
const result = schema.parse(llmOutput);
```

Both variants return the same TypeScript type (`FormGenerationOutput`); only the runtime validation differs. In anonymous mode, rule (1) is skipped — Q1 may be any input type, but rule (2) still requires it at position 0.

A convenience export `formGenerationOutputSchema` is aliased to the non-anonymous factory call, used for type inference.

**Example:**

```json
{
  "questions": [
    {
      "prompt": "What should I call you?",
      "position": 0,
      "input_type": "name",
      "options": null
    },
    {
      "prompt": "How often does AI actually save you time on real work?",
      "position": 1,
      "input_type": "emoji_slider",
      "options": { "min_label": "Never", "max_label": "Constantly" }
    },
    {
      "prompt": "Which one resonates most?",
      "position": 2,
      "input_type": "cards",
      "options": ["Excited", "Curious", "Cautious", "Worried"]
    }
  ],
  "archetype_clusters": [
    {
      "label": "Cautious Adopter",
      "description": "Curious about AI but worried about its pace.",
      "indicator_signals": ["picks cautious options", "expresses anxiety"]
    },
    {
      "label": "Builder Believer",
      "description": "Sees AI as the next great creative tool.",
      "indicator_signals": ["picks excited", "high slider values"]
    },
    {
      "label": "Quiet Skeptic",
      "description": "Doubts the hype but is paying attention.",
      "indicator_signals": ["short answers", "low slider values"]
    }
  ]
}
```

---

### 4. `Persona`

A synthetic respondent used for Stage C seed-data generation. 10 personas per form.

**Produced:** Stage B (persona generation).

**Consumed:** Stage C, which generates one full `SeedResponse` per persona. Persona names should be unique within a form.

**Fields:**

| Field | Type | Notes |
|---|---|---|
| `name` | `string` | First name only. Plausible, not Western-default — Indian / global mix. |
| `age_range` | `string` | e.g. "25-34". |
| `occupation` | `string` | 1 sentence. |
| `stance` | `string` | 1–2 sentences — what makes their answers coherent. |
| `voice_quirks` | `string` | 1–2 sentences — speech patterns, tone, things they say or avoid. |
| `archetype_label` | `string` | Must match one of the form's `ArchetypeCluster.label` values. Cross-validated at runtime, not in Zod. |

**Example:**

```json
{
  "name": "Aarav",
  "age_range": "25-34",
  "occupation": "Mid-level product designer at a SaaS startup, ships weekly.",
  "stance": "Adopts AI tools eagerly for personal use but is uneasy about junior designers being skipped over.",
  "voice_quirks": "Speaks in short bursts, peppered with 'honestly' and 'tbh'. Avoids hyperbole.",
  "archetype_label": "Cautious Adopter"
}
```

---

### 5. `SeedResponse`

A complete answer set for one persona across every question in a form.

**Produced:** Stage C, once per persona (10 per form).

**Consumed:** the seed-insertion job that writes `sessions` + `answers` rows with `is_seed = true` (column added in Phase 2).

The answer shape mirrors `Question.input_type` exactly via a discriminated union.

**Fields:**

| Field | Type | Notes |
|---|---|---|
| `persona_name` | `string` | For traceability. Matches `Persona.name`. |
| `answers` | `SeedAnswer[]` | One entry per question, in question order. |

**`SeedAnswer` shape per `input_type`:**

| `input_type` | Answer shape | Notes |
|---|---|---|
| `name` | `{ value: string }` | The persona's name (must match `persona_name`). |
| `voice` | `{ transcript: string }` | 1–3 sentences in the persona's voice. |
| `text` | `{ transcript: string }` | 1–3 sentences in the persona's voice. |
| `emoji_slider` | `{ value: number }` | 0–100. |
| `cards` | `{ selected: string }` | Must match one of the question's options. |
| `ranking` | `{ ordered: string[] }` | A permutation of the question's options. |
| `this_or_that` | `{ selected: string }` | Must match one of the 2 options. |
| `visual_select` | `{ selected: string }` | Must match one option's `label` (not `image_url`). |

**Cross-validation (runtime, not Zod):** that `cards.selected` / `this_or_that.selected` / `visual_select.selected` is actually one of the corresponding question's options, and that `ranking.ordered` is a permutation of the question's options. The Zod schema only enforces the structural shape, since the question list isn't in scope for the schema itself. The seed-insertion job performs this check before write.

**Example (excerpted):**

```json
{
  "persona_name": "Aarav",
  "answers": [
    { "input_type": "name", "value": "Aarav" },
    { "input_type": "emoji_slider", "value": 62 },
    { "input_type": "cards", "selected": "Curious" },
    {
      "input_type": "voice",
      "transcript": "Honestly, I use AI every day for design exploration, but it makes me nervous about the next generation of designers."
    },
    {
      "input_type": "ranking",
      "ordered": ["Speed", "Creativity", "Reliability", "Privacy"]
    },
    { "input_type": "this_or_that", "selected": "Helpful" },
    { "input_type": "visual_select", "selected": "Studio at dusk" }
  ]
}
```

---

### 6. `Identity`

The form-specific identity assigned to a respondent at the end of their session.

**Produced:** Phase 5 identity classification (`/api/complete-session`).

**Consumed:** `CompleteStage`, the share page, and the `sessions` row (`identity_label`, `identity_summary` columns).

**Fields:**

| Field | Type | Notes |
|---|---|---|
| `label` | `string` | Must match one of the form's `ArchetypeCluster.label` values. |
| `summary` | `string` | 1–2 sentences in the **respondent's voice** — written *as if* it were them describing themselves. |
| `highlights` | `string[]` | Exactly 3 standout moments (short phrases, not full quotes). |

**`label` cross-validation.** The valid label set is per-form runtime data and cannot be statically encoded. The schema layer exposes two surfaces:

- `identitySchema` — validates structural shape only.
- `identitySchemaFor(allowedLabels)` — returns a refined schema that also enforces `label ∈ allowedLabels`. Phase 5 call sites should fetch the form's archetype list, then call this helper before validating LLM output.

**No generic fallback.** If the Phase 5 LLM call fails or produces invalid output (including a label not in the archetype list), the surface should show an error state. **Do not** substitute a default like "Quiet Observer" — the existing fallback in `app/api/complete-session/route.ts` is being intentionally removed in a later phase.

**Example:**

```json
{
  "label": "Cautious Adopter",
  "summary": "I lean in just enough to keep up, but I'd rather we slow down than break what's already working.",
  "highlights": [
    "uses AI daily for drafts",
    "worried about junior designers",
    "ranks reliability above speed"
  ]
}
```
