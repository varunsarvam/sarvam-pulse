# Sarvam Pulse — Codebase State Snapshot

**Generated:** 2026-04-30  
**Branch:** main  
**Last commit:** `4b00111` — ui: implement Figma voice/text UI & waveform

---

## Section 1 — Project Structure

```
/Users/andevarun/sarvam pulse/
├── app/                         # Next.js App Router pages + API routes
│   ├── api/                     # Server-side API handlers
│   │   ├── answers/route.ts     # Core answer submission + aggregation + reflection engine
│   │   ├── complete-session/    # Identity card generation at end of flow
│   │   ├── follow-up/           # Decides whether to ask a follow-up question
│   │   ├── forms/route.ts       # Form + question creation
│   │   ├── normalize/           # (Exists in git history; no folder present — inlined to lib/llm.ts)
│   │   ├── phrase-question/     # LLM rewrites creator question in chosen tone
│   │   ├── reactions/route.ts   # Emoji reaction recording
│   │   ├── sessions/route.ts    # Session creation + name patching
│   │   ├── transcribe/route.ts  # Sarvam STT
│   │   └── tts/route.ts         # Sarvam TTS (bulbul:v3 stream)
│   ├── create/page.tsx          # Creator UI — build a form
│   ├── respond/[formId]/        # Respondent flow (multi-stage)
│   │   ├── page.tsx             # Server component: fetches form + questions
│   │   ├── RespondentFlow.tsx   # Client: all stages — ENTRY/SETUP/QUESTION/FOLLOWUP/REFLECTION/COMPLETE
│   │   └── loading.tsx          # Loading skeleton
│   ├── share/[sessionId]/       # Public share page for identity cards
│   ├── shader-lab/              # Internal dev page for WebGL shader tuning (not user-facing)
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx                 # Forms dashboard (SSR)
├── components/
│   ├── inputs/                  # One component per input type
│   │   ├── Cards.tsx
│   │   ├── EmojiSlider.tsx      # Lottie-animated emoji grid
│   │   ├── Ranking.tsx          # dnd-kit drag-to-reorder
│   │   ├── TextInput.tsx
│   │   ├── ThisOrThat.tsx
│   │   ├── VisualSelect.tsx
│   │   └── VoiceInput.tsx       # AudioWorklet PCM capture → WAV → transcribe
│   ├── reflection/              # Sub-components for each reflection visual
│   │   ├── ReflectionDistribution.tsx  # Bar chart for closed questions
│   │   ├── ReflectionSlider.tsx        # Slider percentile visual
│   │   └── ReflectionTribe.tsx         # Quote stack for cluster matches
│   ├── AIPresence.tsx           # Animated AI avatar (idle/thinking/speaking modes)
│   ├── BackgroundMusic.tsx      # Ambient MP3 player with ducking
│   ├── CompleteStage.tsx        # 3D tilt identity card + export
│   ├── FormCard.tsx             # Dashboard card for each form
│   ├── PresenceShader.tsx       # WebGL fluted-glass shader background
│   ├── Reflection.tsx           # Top-level reflection switcher + reaction buttons
│   ├── ShareCard.tsx            # Static share card (for /share/[sessionId])
│   └── TTSPlayer.tsx            # Plays preloaded TTS audio + drives typewriter
├── docs/                        # Architecture and design docs
├── hooks/
│   ├── useAudioCapture.ts       # (Legacy hook, largely superseded by VoiceInput internals)
│   └── useLiveData.ts           # Supabase realtime subscriber for entry screen
├── lib/
│   ├── llm.ts                   # normalizeAnswer() — cluster classification + sentiment
│   ├── reflection.ts            # pickReflectionWithDebug() + generateReflectionCopy()
│   ├── sarvam.ts                # Sarvam API wrappers (STT, TTS, chatComplete, chatCompleteStream)
│   ├── sounds.ts                # Thin wrapper around click/whoosh sound effects
│   ├── supabase/client.ts       # Browser Supabase client
│   ├── supabase/server.ts       # Server (service role) Supabase client
│   ├── types.ts                 # Shared TypeScript interfaces
│   └── utils.ts                 # cn() class merge helper
├── public/
│   ├── audio/bg-music.mp3       # Ambient background loop
│   ├── pcm-processor.js         # AudioWorklet for 16kHz PCM capture
│   └── *.png / *.jpg            # Assets used in the entry screen card
├── scripts/
│   └── seed.ts                  # Seed ~80 responses for the hero demo form
├── .env.example
├── AGENTS.md / CLAUDE.md        # AI agent instructions
└── next.config.ts
```

---

## Section 2 — Database Schema

### Schema (verbatim from `docs/data-model.md`)

```sql
create table forms (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  intent text,
  tone text default 'playful', -- 'playful' | 'calm' | 'direct' | 'insightful'
  status text default 'draft', -- 'draft' | 'published'
  created_at timestamptz default now()
);

create table questions (
  id uuid primary key default gen_random_uuid(),
  form_id uuid references forms(id) on delete cascade,
  position int not null,
  prompt text not null,
  intent text,
  input_type text not null, -- 'voice' | 'text' | 'emoji_slider' | 'cards' | 'ranking' | 'this_or_that' | 'visual_select'
  options jsonb,
  follow_up_enabled boolean default true,
  required boolean default true
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  form_id uuid references forms(id),
  started_at timestamptz default now(),
  completed_at timestamptz,
  respondent_name text,
  identity_label text,
  identity_summary text
);

create table answers (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references sessions(id) on delete cascade,
  question_id uuid references questions(id),
  raw_value jsonb not null,
  transcript text,
  normalized jsonb,
  sentiment real,
  created_at timestamptz default now()
);

create table reactions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references sessions(id),
  question_id uuid references questions(id),
  reaction text not null, -- 'fire' | 'eyes' | 'hundred' | 'thinking'
  created_at timestamptz default now()
);

create table aggregations (
  question_id uuid primary key references questions(id),
  total_responses int default 0,
  distribution jsonb default '{}',
  sentiment_avg real default 0,
  recent_quotes jsonb default '[]',
  clusters jsonb default '[]',
  updated_at timestamptz default now()
);
```

Realtime enabled on: `sessions`, `reactions`, `aggregations`.  
RLS **disabled** on all tables (hackathon mode — anonymous reads work without auth).

### Tables Referenced in Code

All six schema tables are actively used:

| Table | Files |
|---|---|
| `forms` | `app/page.tsx`, `app/api/forms/route.ts`, `app/respond/[formId]/page.tsx`, `app/share/[sessionId]/page.tsx` |
| `questions` | `app/respond/[formId]/page.tsx`, `app/api/forms/route.ts`, `app/api/answers/route.ts`, `scripts/seed.ts` |
| `sessions` | `app/page.tsx`, `app/api/sessions/route.ts`, `app/api/answers/route.ts`, `app/api/complete-session/route.ts`, `app/share/[sessionId]/page.tsx`, `hooks/useLiveData.ts`, `scripts/seed.ts` |
| `answers` | `app/api/answers/route.ts`, `app/api/complete-session/route.ts`, `scripts/seed.ts` |
| `reactions` | `app/api/reactions/route.ts`, `hooks/useLiveData.ts`, `scripts/seed.ts` |
| `aggregations` | `app/api/answers/route.ts`, `app/api/complete-session/route.ts`, `hooks/useLiveData.ts`, `scripts/seed.ts` |

**No schema mismatches detected.** Code field names match the schema exactly. The `normalize` API route that existed as a standalone route in early commits was inlined into `lib/llm.ts` — no orphan table references remain.

---

## Section 3 — Pages and Routes

### `/` — Forms Dashboard (`app/page.tsx`)
- **Type:** Server component (async)
- **Data:** Fetches all forms + all sessions via `createAdminClient()`, computes per-form `responseCount` / `completedCount` in memory.
- **Components:** `FormCard`, `Button`, `Link`
- **API hits:** None (direct Supabase SSR)

### `/create` — Form Creation (`app/create/page.tsx`)
- **Type:** Client component
- **State:** Local draft: `title`, `intent`, `tone`, array of `DraftQuestion`
- **On publish:** `POST /api/forms` → redirects to `/respond/[id]`
- **Options are hand-authored** — no LLM involvement in question creation

### `/respond/[formId]` — Respondent Flow
- **`page.tsx`:** Server component; fetches `form` + `questions` from Supabase; passes to `RespondentFlow`
- **`RespondentFlow.tsx`:** Large client component (~1700 lines) managing all stages:
  - **ENTRY** — live stats from `useLiveData`, floating quotes card, "Let's start" button
  - **SETUP** — name capture, preloads all questions (phrase + TTS audio) in parallel
  - **QUESTION** — `GET /api/phrase-question` (SSE or JSON), `TTSPlayer`, renders appropriate input component
  - **FOLLOWUP** — `POST /api/follow-up` after voice/text answers
  - **REFLECTION** — renders `Reflection` component with data from `POST /api/answers` response
  - **COMPLETE** — `CompleteStage` calls `POST /api/complete-session`

### `/share/[sessionId]` — Share Page (`app/share/[sessionId]/page.tsx`)
- **Type:** Server component; fetches session + joined form
- **Generates OG metadata** dynamically from `identity_label`/`identity_summary`
- **Components:** `ShareCard`, `Button`
- **Shows:** identity label, summary, link back to the form

### `/shader-lab` — Internal dev tool (not user-facing)
- WebGL shader parameter playground using `@paper-design/shaders-react`

---

## Section 4 — API Routes

### `POST /api/forms`
- **File:** `app/api/forms/route.ts`
- **Tables written:** `forms` (insert), `questions` (insert)
- **Logic:** Validates title, inserts form with `status: "published"`, bulk-inserts questions.
- **Returns:** `{ id: form.id }`

### `POST /api/sessions` / `PATCH /api/sessions`
- **File:** `app/api/sessions/route.ts`
- **Tables written:** `sessions` (insert on POST, update on PATCH)
- **POST:** Creates a session for a form, optionally sets `respondent_name`
- **PATCH:** Updates `respondent_name` on an existing session after name is entered

### `POST /api/answers` — Most important route
- **File:** `app/api/answers/route.ts`
- **Tables read:** `questions`, `aggregations`, `sessions`
- **Tables written:** `answers` (insert + update), `aggregations` (upsert)
- **LLM calls:** `sarvam-105b` via `lib/llm.ts` for normalize (voice/text only); `sarvam-30b` via `lib/reflection.ts` for reflection copy generation
- **6-phase pipeline:** Insert answer → normalize (if open-ended) → compute updated aggregation → persist aggregation → pick reflection → generate LLM copy
- **Returns:** `{ reflection, null_reason?, debug_info?, next_question_id }`

### `POST /api/phrase-question`
- **File:** `app/api/phrase-question/route.ts`
- **LLM:** `sarvam-30b`, `temperature: 0.9`, `max_tokens: 150`, thinking disabled
- **Response modes:** SSE stream (default) or JSON (when `response_mode: "json"` — used during preload)
- **Caching:** In-memory `Map` keyed by `{ session_id, question_prompt, tone, form_intent, respondent_name }`
- **Returns:** Rewritten question in chosen tone; falls back to original on error

### `POST /api/follow-up`
- **File:** `app/api/follow-up/route.ts`
- **LLM:** `sarvam-30b`, `temperature: 0.6`, `max_tokens: 60`, thinking disabled
- **Logic:** Returns a single follow-up question (max 15 words) or `null` (if model outputs `SKIP`)
- **Only triggered for voice/text answers** with a non-empty transcript

### `POST /api/complete-session`
- **File:** `app/api/complete-session/route.ts`
- **LLM:** `sarvam-105b`, `temperature: 0.7`, `max_tokens: 400`, `reasoning_effort: "low"`
- **Tables read:** `sessions`, `answers` (joined with `questions`), `aggregations`
- **Tables written:** `sessions` (updates `identity_label`, `identity_summary`, `completed_at`)
- **Returns:** `{ identity: { label, summary, highlights }, percentiles[], respondent_name }`

### `POST /api/transcribe`
- **File:** `app/api/transcribe/route.ts`
- **Model:** Sarvam `saarika:v2.5`, `language_code: "en-IN"`, via `sarvamai` SDK
- **Input:** `multipart/form-data` with WAV blob

### `POST /api/tts`
- **File:** `app/api/tts/route.ts`
- **Model:** Sarvam `bulbul:v3`, via `sarvamai` SDK streaming
- **Voice:** mapped from form tone (`insightful→varun`, `playful→anushka`, `calm→neha`, `direct→rahul`)
- **Returns:** `audio/mpeg` stream

### `POST /api/reactions`
- **File:** `app/api/reactions/route.ts`
- **Tables written:** `reactions` (insert)
- **Validates:** reaction must be one of `fire | eyes | hundred | thinking`

---

## Section 5 — Seven Problem Areas

### 5a. Question Phrasing

**File:** `app/api/phrase-question/route.ts`

**Model:** `sarvam-30b`, temperature 0.9, max_tokens 150, `enable_thinking: false`

**System prompt (assembled at runtime):**
```
You are the host of a conversational form. Your job is to REWRITE the given question...
Tone: {tone}. [Form intent: {form_intent}.]
[Respondent name instruction if name provided.]
Hard rules:
- Output is ALWAYS a rewrite. Never echo the original wording.
- Length: 1-2 sentences, max 35 words.
- No preamble. No "Sure, here is...". No quotation marks. Just the rewritten question.
- Preserve the question's meaning exactly.
- Vary every call.
- Be evocative and warm, not formulaic.
[Shot examples for variation in insightful tone]
```

**User message:** `Original question: {question_prompt}` (optionally with previous answers context)

**Caching logic:** In-memory `Map`, keyed by JSON of `{ session_id, question_prompt, tone, form_intent, respondent_name }`. Cache hit returns instant JSON. No session_id → no caching. No persistence across restarts.

**Client-side secondary cache:** `sessionStorage` keyed `phrase:{session_id}:{question_id}`. Written on first fetch; read on re-render of same question.

**Fallback:** Original creator-written `question.prompt` if LLM fails or times out.

### 5b. Input Options for Questions

Options are **entirely hand-authored** by the form creator via the `/create` UI.

- `cards`, `ranking`, `visual_select`: free-text option list (min 1, unlimited)
- `this_or_that`: exactly 2 options enforced in UI
- `visual_select`: each option has `label` + `image_url` (manual URL entry)
- `voice`, `text`, `emoji_slider`: no options field

Options are stored as `jsonb` in `questions.options`. The schema doc specifies the shapes:
```
cards/this_or_that: ["option_a", "option_b", ...]
visual_select: [{"label": "...", "image_url": "..."}]
ranking: ["item_a", "item_b", ...]  (initial order)
```

No LLM is involved in generating options. The seed script hardcodes realistic options for the "Living With AI in 2026" demo form.

### 5c. Form Creation Flow

1. Creator fills `/create` form: title, intent, tone, questions (prompt, intent, input type, options).
2. `handlePublish()` validates locally (prompt required, correct option counts).
3. `POST /api/forms` with `{ title, intent, tone, questions[] }`.
4. Server inserts into `forms` with `status: "published"`, then bulk-inserts into `questions`.
5. Response: `{ id: form.id }`.
6. Client redirects to `/respond/[id]` — the creator can immediately see the form as a respondent.

**No draft state** — forms are always published immediately. No aggregation rows are pre-created; they are upserted on first answer.

### 5d. Seed Data

**File:** `scripts/seed.ts`  
**Usage:** `npx tsx scripts/seed.ts <formId> [count=80]`

The script targets the **"Living With AI in 2026"** form (created manually via the creator UI first). It generates ~80 synthetic sessions using 6 persona archetypes with weighted probabilities:

| Persona | Weight |
|---|---|
| Cautious Adopter | 22% |
| Builder Believer | 18% |
| Pragmatic User | 18% |
| Curious Skeptic | 15% |
| Hopeful Realist | 15% |
| Quiet Resistor | 12% |

Each persona has pre-written voice/text responses, weighted option preferences for closed questions, slider ranges, and ranking priorities. Sessions are spread across the past 24 hours. 60% of sessions get 1-2 reactions inserted.

After all sessions are inserted, the script recomputes all `aggregations` rows directly (bypassing API routes for speed). Cluster labels are hand-assigned from a `personaClusterMap` dictionary — the LLM normalize step is skipped during seeding.

### 5e. Aggregations

There are **no Postgres triggers or functions** — all aggregation logic runs in the `/api/answers` route in Node.js.

**When updated:** On every `POST /api/answers` call, in Phase 4 of the 6-phase pipeline.

**What is precomputed per question:**

| Field | How it updates |
|---|---|
| `total_responses` | Increment by 1 |
| `distribution` | Per input type: option count, slider bucket, ranking position average |
| `sentiment_avg` | Rolling average: `(old_avg * old_total + new_sentiment) / new_total` |
| `recent_quotes` | Prepend answer text (≤80 chars), keep last 10 |
| `clusters` | Find/create cluster by label, increment count, append example (max 5) |
| `updated_at` | Current timestamp |

Aggregation is upserted with `supabase.from("aggregations").upsert(...)`. The pre-mutation snapshot is captured before this write and used for reflection comparison, preventing the current respondent's answer from influencing their own reflection.

### 5f. Counters on Entry Screen

**File:** `hooks/useLiveData.ts`

**Initial load (on mount):**
- Participant count: `supabase.from("sessions").select("id", { count: "exact" }).eq("form_id").gte("started_at", 24h ago)` — last 24 hours
- Quotes: `supabase.from("aggregations").select("recent_quotes").in("question_id", questionIds)` — shuffled and merged
- Reaction count: `supabase.from("reactions").select("id", { count: "exact" }).in("question_id").gte("created_at", 1h ago)` — last 1 hour

**Realtime updates via Supabase postgres_changes:**
- `sessions` INSERT filtered by `form_id` → increments `countRef.current`
- `aggregations` UPDATE (unfiltered, client-side filtered by question set) → merges fresh `recent_quotes`
- `reactions` INSERT (unfiltered, client-side filtered) → increments count, triggers emoji pop animation

**Debouncing:** State updates are batched at 1500ms intervals via `setInterval`; reaction pops fire immediately (1.2s animation then cleaned up).

**"3 Mins" counter** on the entry screen card is **hardcoded** to `3` (see `RespondentFlow.tsx` line ~309).

### 5g. Identity Card / Completion

**File:** `app/api/complete-session/route.ts`

**Triggered by:** `CompleteStage.tsx` on mount, calling `POST /api/complete-session` with `{ session_id }`.

**LLM:** `sarvam-105b`, `temperature: 0.7`, `max_tokens: 400`, `reasoning_effort: "low"`

**System prompt:**
```
Given a respondent's answers across a form about how they live with AI, generate:
1. An identity label - 2-4 words, evocative, like 'Curious Skeptic' or 'Quiet Optimist'...
2. A 1-2 sentence summary of their perspective in their own voice.
3. 3 standout 'highlights' - their most distinctive moments from the form.
[Optional: personalization block if respondent_name is set]

Output strict JSON only, no preamble or markdown:
{ "label": "...", "summary": "...", "highlights": ["...", "...", "..."] }
```

**User message:** All Q&A pairs formatted as `Q1: ...\nA1: ... [theme: cluster_label]` (normalized cluster shown as context).

**Parsing:** Two-stage — direct `JSON.parse`, then regex fallback `/{[\s\S]*}/` if markdown fences or preamble slipped through.

**Fallback identity** on any parse failure or LLM error:
```
{ label: "Quiet Observer", summary: "You took the time to share thoughtful answers...", highlights: [...] }
```

**After identity generation:** Supabase `sessions.update({ identity_label, identity_summary, completed_at })`.

**Percentiles:** Computed in Node.js for any `emoji_slider` answers by fetching their `aggregations.distribution` and interpolating bucket position. Returned alongside identity.

---

## Section 6 — Sarvam Integration

### Summary from `docs/sarvam-integration.md` + `lib/sarvam.ts`

**Auth:** Single header `api-subscription-key: ${SARVAM_API_KEY}` for all calls (STT, TTS, LLM).

**Models in use:**

| Route | Model | Notes |
|---|---|---|
| `/api/phrase-question` | `sarvam-30b` | Streaming SSE or JSON; `enable_thinking: false`; temp 0.9 |
| `/api/follow-up` | `sarvam-30b` | Non-streaming; `enable_thinking: false`; temp 0.6; max 60 tokens |
| `/api/answers` (normalize) | `sarvam-105b` | Non-streaming; `enable_thinking: false`; temp 0.1; JSON output |
| `/api/answers` (reflection copy) | `sarvam-30b` | Non-streaming; `enable_thinking: false`; temp 0.85; max 60 tokens; 2.5s timeout race |
| `/api/complete-session` | `sarvam-105b` | Non-streaming; `reasoning_effort: "low"`; temp 0.7; max 400 tokens |
| `/api/transcribe` | `saarika:v2.5` | Via `sarvamai` SDK; language `en-IN`; WAV input from AudioWorklet |
| `/api/tts` | `bulbul:v3` | Via `sarvamai` SDK streaming; `output_audio_codec: mp3`; 24kHz |

**Voice mapping by tone:**
- `insightful → varun`
- `playful → anushka`
- `calm → neha`
- `direct → rahul`

**Note:** The `docs/sarvam-integration.md` doc lists older voice names (`manisha`, `abhilash`, `vidya`) that differ from the code. The authoritative mapping is in `lib/sarvam.ts` (`TONE_VOICE` object). The doc is stale on this point.

**JSON mode:** The API does not have a dedicated JSON mode parameter. JSON output is enforced via system prompt instruction (`Output strict JSON only`). Markdown fence stripping + regex fallback is applied everywhere JSON is expected.

**Batched calls:** No batching. Each answer submission fires normalize and reflection copy as sequential calls within the same request. Phrase-question + TTS for all questions are fired in parallel during SETUP via `Promise.allSettled`.

**Latency tracking:** `console.time`/`timeEnd` instrumentation on all LLM calls. Target: `/api/answers` under 1 second total; normalize is cited as the slowest piece (~500ms).

**Failure fallbacks:**

| Failure | Fallback |
|---|---|
| STT error | UI shows "try typing instead" |
| TTS error | Skip audio, show text only |
| phrase-question error | Show original creator-written question |
| normalize error | `normalized=null`, `sentiment=0`, clusters not updated |
| follow-up error | Skip follow-up, proceed to reflection |
| complete-session LLM error | "Quiet Observer" fallback identity |
| reflection copy timeout (>2.5s) | Deterministic local copy from `FALLBACK_VARIANTS` |

---

## Section 7 — Recent Changes

### Commits in the last 2 days (all on `main`):

Most recent 20+ commits are focused on **UI polish of the Reflection and EmojiSlider components**:

- Reaction buttons hidden (`feat: hide all reactions; skip cards reflection with no distribution`)
- Sticker/button styling iterations (FigJam-style, die-cut outlines, drop shadows)
- EmojiSlider rebuilt: Lottie animated emoji, grid layout, spectrum colors, no slider track
- ReflectionDistribution redesigned multiple times (sci-fi amber, Bauhaus, terracotta orange)
- ReflectionSlider exact emoji + particle distribution fix
- ComparisonVisual gradient, font, collision fixes
- `RespondentFlow.tsx` — "Moving on…" text made white

### TODOs / FIXMEs / HACKs:

```
app/respond/[formId]/RespondentFlow.tsx:1578
// TODO: replace with paper shader avatar synced to TTS
```

This is the only annotation. The `AIPresence` component is rendered in a `div` with `className="hidden"` — the left-panel avatar is fully commented out for the current UI design.

### ESLint-flagged issues:

```
RespondentFlow.tsx:1636 — react-hooks/refs: Cannot access refs during render
  (preloadCacheRef.current.get(...) called during JSX render)
CompleteStage.tsx:146 — prefer-const: 'diff' should be const
Reflection.tsx:388 — @ts-ignore should be @ts-expect-error
components/inputs/Ranking.tsx:21 — 'Button' imported but never used
components/inputs/VoiceInput.tsx:227 — 'TranscribingBlock' defined but never used
scripts/seed.ts — multiple no-explicit-any violations
```

### Commented-out code blocks:

In `RespondentFlow.tsx` lines 1563–1585: The entire left-column AI presence panel is rendered as `className="hidden"` with an inline TODO. The structure exists but is visually disabled.

### Duplicate component files: None found.

---

## Section 8 — Build / Type Checks

### `npm run build`

**Result: FAILED**

```
./components/inputs/EmojiSlider.tsx:91:9
Type error: Type 'unknown' is not assignable to type 'ReactNode'.
```

The Lottie `animationData` prop is typed as `unknown` (from a dynamic `import()`) and is rendered directly in JSX, which Next.js 16 rejects at build time.

### `npx tsc --noEmit`

**4 errors:**

```
components/inputs/EmojiSlider.tsx(91,9): Type 'unknown' not assignable to 'ReactNode'
components/inputs/VoiceInput.tsx(190,40): 'canvas' is possibly 'null'
components/inputs/VoiceInput.tsx(190,54): 'canvas' is possibly 'null'
components/inputs/VoiceInput.tsx(416,5): Cannot find name 'setElapsed'
components/reflection/ReflectionSlider.tsx(194,11): 'path' property does not exist on Lottie component type
```

The `VoiceInput.tsx:416 setElapsed` error suggests a stale variable reference after a recent refactor.

### `npx eslint .`

**22 errors, 6 warnings** (see Section 7 for details). Most critical is the ref-during-render error in `RespondentFlow.tsx`.

---

## Section 9 — Environment Variables

### Variables used in code:

| Variable | Location | Purpose |
|---|---|---|
| `SARVAM_API_KEY` | `lib/sarvam.ts`, `app/api/transcribe/route.ts`, `app/api/tts/route.ts` | Sarvam API auth for all LLM/STT/TTS calls |
| `NEXT_PUBLIC_SUPABASE_URL` | `lib/supabase/client.ts`, `lib/supabase/server.ts`, `scripts/seed.ts` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `lib/supabase/client.ts` | Anon key for browser-side Supabase client |
| `SUPABASE_SERVICE_ROLE_KEY` | `lib/supabase/server.ts`, `scripts/seed.ts` | Service role key for all server-side DB writes |
| `NEXT_PUBLIC_REFLECTION_DEBUG` | `app/respond/[formId]/RespondentFlow.tsx` | If `"true"`, shows `[LLM]`/`[FALLBACK]` labels and null-reason details on reflection cards |

### `.env.example` (all variables documented):

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SARVAM_API_KEY=
NEXT_PUBLIC_REFLECTION_DEBUG=
```

All 5 variables in `.env.example` match code usage exactly. No undocumented variables found.

---

## Section 10 — Open Questions

1. **Build is broken.** `EmojiSlider.tsx` has a TS error (`unknown` not assignable to `ReactNode` for Lottie `animationData`) and `ReflectionSlider.tsx` uses a `path` prop that doesn't exist on the Lottie component type. These block production deployments.

2. **`setElapsed` undefined in `VoiceInput.tsx:416`.** A variable reference that doesn't resolve — likely a refactor artifact. Needs a missing state declaration or deletion.

3. **`ref.current` read during render (`RespondentFlow.tsx:1636`).** `preloadCacheRef.current.get(...)` is called inside JSX, violating the React rule against refs-in-render. This can cause stale cache reads. Should be moved to a state value or derived in an effect.

4. **Sarvam integration doc is stale.** `docs/sarvam-integration.md` lists voice names (`manisha`, `abhilash`, `vidya`) that differ from the code (`neha`, `rahul`, `varun`). The TTS API endpoint described in the doc (`text-to-speech` returning base64) also differs from the implementation (which uses `textToSpeech.convertStream` from the `sarvamai` SDK returning a stream). The doc appears to describe an earlier API design.

5. **In-memory phrase-question cache.** The `Map` in `app/api/phrase-question/route.ts` is unbounded and has no TTL or eviction policy. Under sustained load (many forms, many sessions), this could grow indefinitely. Affects serverless deployments where the process may restart anyway.

6. **No aggregation rows pre-created.** The first respondent to answer any question will trigger an upsert with a fresh aggregation. Reflections requiring minimum thresholds (5–10 responses) will return `null` for early respondents — this is by design but may be jarring for the first few users of a new form.

7. **`sessions` live count uses last 24 hours**, but `reactions` counter uses last 1 hour. These windows are inconsistent and not documented for the user. The entry card shows both numbers without labeling the time window.

8. **"3 Mins" is hardcoded** on the entry screen card. It doesn't reflect actual median completion time for any given form.

9. **`lib/sarvam.ts` has two TTS implementations.** The `textToSpeech()` function (direct fetch, base64 response) and the route handler `app/api/tts/route.ts` (SDK streaming) use different code paths. `textToSpeech()` is exported but not called anywhere in the app — it appears to be dead code from an earlier implementation.

10. **No auth or ownership model.** All forms, sessions, and answers are globally readable/writable by anyone with the Supabase URL (RLS is disabled). This is intentional for the hackathon but means the dashboard shows all forms in the DB, not just the current user's.
