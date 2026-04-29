# Pulse Data Model (FROZEN — do not modify after Phase 0)

## Tables

-- A form created by you (the demo creator)

create table forms (

  id uuid primary key default gen_random_uuid(),

  title text not null,

  intent text,

  tone text default 'playful', -- 'playful' | 'calm' | 'direct' | 'insightful'

  status text default 'draft', -- 'draft' | 'published'

  created_at timestamptz default now()

);

-- Each question in a form

create table questions (

  id uuid primary key default gen_random_uuid(),

  form_id uuid references forms(id) on delete cascade,

  position int not null, -- order in the form

  prompt text not null, -- the question text

  intent text, -- what we're trying to learn

  input_type text not null, -- 'voice' | 'text' | 'emoji_slider' | 'cards' | 'ranking' | 'this_or_that' | 'visual_select'

  options jsonb, -- for cards/ranking/this_or_that/visual_select: the choices

  follow_up_enabled boolean default true,

  required boolean default true

);

-- A respondent session (one person filling out the form)

create table sessions (

  id uuid primary key default gen_random_uuid(),

  form_id uuid references forms(id),

  started_at timestamptz default now(),

  completed_at timestamptz,

  identity_label text, -- e.g. "Curious Skeptic" - generated at completion

  identity_summary text -- 1-2 sentence summary

);

-- Each answer to each question

create table answers (

  id uuid primary key default gen_random_uuid(),

  session_id uuid references sessions(id) on delete cascade,

  question_id uuid references questions(id),

  raw_value jsonb not null, -- the actual answer (text, choice, slider value)

  transcript text, -- if voice, the transcribed text

  normalized jsonb, -- LLM-classified version: which cluster/category

  sentiment real, -- -1.0 to 1.0

  created_at timestamptz default now()

);

-- Reactions to insights (the 🔥 👀 💯 🤔 system)

create table reactions (

  id uuid primary key default gen_random_uuid(),

  session_id uuid references sessions(id),

  question_id uuid references questions(id),

  reaction text not null, -- 'fire' | 'eyes' | 'hundred' | 'thinking'

  created_at timestamptz default now()

);

-- Pre-computed aggregations per question (updated on each answer)

create table aggregations (

  question_id uuid primary key references questions(id),

  total_responses int default 0,

  distribution jsonb default '{}', -- for closed inputs: {"option_a": 12, "option_b": 8}

  sentiment_avg real default 0,

  recent_quotes jsonb default '[]', -- last 10 short quotes for floating display

  clusters jsonb default '[]', -- for open text: [{"label": "speed-focused", "count": 23, "examples": [...]}]

  updated_at timestamptz default now()

);

-- Enable realtime for the tables that drive live UI

alter publication supabase_realtime add table sessions;

alter publication supabase_realtime add table reactions;

alter publication supabase_realtime add table aggregations;

-- For the hackathon demo: disable RLS on all tables so anonymous reads work without auth setup

-- (NOT for production)

alter table forms disable row level security;

alter table questions disable row level security;

alter table sessions disable row level security;

alter table answers disable row level security;

alter table reactions disable row level security;

alter table aggregations disable row level security;

## Relationships

forms (1) → (many) questions

forms (1) → (many) sessions

sessions (1) → (many) answers

sessions (1) → (many) reactions

questions (1) → (1) aggregations

questions (1) → (many) answers

questions (1) → (many) reactions

## Realtime subscriptions

Three tables emit realtime events:

- sessions — drives "live participant count" on entry screen
- reactions — drives the floating emoji reactions on entry screen
- aggregations — drives the floating recent quotes

Subscribe with filters by form_id (sessions, reactions) or by question_id from this form's questions (aggregations).

## JSON shapes inside the schema

questions.options (jsonb):

- For cards/this_or_that: ["option_a", "option_b", ...]
- For ranking: ["item_a", "item_b", ...] (initial order doesn't matter)
- For visual_select: [{"label": "...", "image_url": "..."}, ...]

answers.raw_value (jsonb), per input type:

- voice: { type: "voice", value:  }
- text: { type: "text", value:  }
- emoji_slider: { type: "emoji_slider", value: <0-100> }
- cards: { type: "cards", value:  }
- ranking: { type: "ranking", value:  }
- this_or_that: { type: "this_or_that", value:  }
- visual_select: { type: "visual_select", value:  }

answers.normalized (jsonb, only for voice/text):

- { cluster: , is_new: , confidence: <0-1> }

aggregations.distribution (jsonb):

- For cards/this_or_that/visual_select: { "": , ... }
- For emoji_slider: { "0-20": n, "20-40": n, "40-60": n, "60-80": n, "80-100": n }
- For ranking: { "": , ... }
- For voice/text: empty {} (clusters lives separately)

aggregations.clusters (jsonb):

- [{ "label": "", "count": , "examples": ["", ...] }, ...]
- Only populated for voice/text questions

aggregations.recent_quotes (jsonb):

- ["", "", ...] — last 10, max 80 chars each
- Mixed across all input types where transcript exists

