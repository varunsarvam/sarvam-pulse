# Pulse Architecture (single source of truth)

## System shape

[Browser] ↔ [Next.js API routes] ↔ [Sarvam APIs + Supabase Postgres]

One repo, one deployment, one database. No microservices, no queues, no separate workers.

## The respondent flow (the only flow that needs to feel magical)

1. ENTRY stage
  - Server fetches form + questions
  - Client subscribes to Supabase realtime for live counts/quotes/reactions
  - User taps "Let's start" → POST /api/sessions → session_id stored in client state
  - Transition to QUESTION stage
2. QUESTION stage (per question)
  - Client calls /api/phrase-question → gets tone-appropriate phrasing
  - Simultaneously calls /api/speak with the phrasing → audio plays as text streams in
  - User responds via the appropriate input component
  - Voice input: audio blob → /api/transcribe → text shown editable → user confirms
  - Other inputs: direct value submitted
  - On submit: POST /api/answers (this triggers the heavy work, see below)
  - If response includes follow_up: ask it, get answer, continue
  - Transition to REFLECTION stage with the returned reflection payload
3. REFLECTION stage
  - Render  component for the chosen type
  - Show 4 reaction emojis
  - On reaction tap or 2.5s timeout: advance to next question or COMPLETE
4. COMPLETE stage
  - POST /api/complete-session → identity label, summary, highlights
  - Sequential reveal animation
  - Share card generation

## The /api/answers route — the most important code in the app

Every answer submission triggers this sequence in ONE API call:

1. Insert row into `answers` table
2. If voice/text: call internal normalize() to classify cluster + sentiment, update answer row
3. Read current `aggregations` row for this question
4. Update aggregation:
  - total_responses += 1
  - For closed inputs: distribution[chosen_option] += 1
  - For slider: increment matching bucket in distribution
  - For ranking: update average position per option
  - For open text: find/create cluster, increment count, update examples
  - sentiment_avg: rolling average using new total_responses
  - recent_quotes: prepend (truncated to 80 chars), keep last 10
5. Write aggregation back (upsert)
6. Optionally call /api/follow-up for voice/text answers
7. Compute reflection via lib/reflection.ts pickReflection()
8. Return { reflection, follow_up?, next_question_id | null }

Total target latency: under 1 second. The normalize LLM call is the slowest piece (~500ms).

## Reflection logic spec

Six reflection types compete on every answer. Each has:

- An eligibility check (does the input type even support this reflection type?)
- A confidence threshold (minimum total_responses)
- A scoring function

Scoring (higher = more likely to be shown):

- comparison [emoji_slider, ranking]: |percentile - 50| / 50; threshold 20
- majority [cards, this_or_that]: max(distribution) / total when chosen IS the max; threshold 15
- minority [cards, this_or_that]: 1 - (chosen_count / total) when chosen is below 25%; threshold 15
- pattern [any]: skipped for hackathon (needs co-occurrence matrix)
- tribe [voice, text]: cluster.count / total when matched cluster has ≥ 5 members; threshold 30
- emotion [any]: |answer_sentiment - sentiment_avg|; threshold 15

Apply session-level penalty: if this reflection type was shown in the last 2 questions, multiply score by 0.5.

Pick highest-scoring type that clears its threshold. If none clear, return null (and the UI shows a smooth transition card instead).

Templates (no LLM, just string interpolation):

- majority: `${pct}% of people also chose ${chosen_label}`
- minority: `Only ${pct}% chose this — you're in rare company`
- comparison (high): `You're in the top ${100 - pct}% on this`
- comparison (low): `You're in the bottom ${pct}% — most lean higher`
- tribe: `You sound like the ${cluster_label_humanized} — ${count} others felt the same`
- emotion (positive aligned): `Most people leaned positive here, like you`
- emotion (contrarian): `Your tone stands apart from the crowd`

## What's NOT being built

- Pattern reflection (co-occurrence) — too complex for 24h
- Real-time clustering re-fitting — clusters grow naturally via normalize() one-by-one, no batch re-clustering
- Analytics dashboard — data is in DB, that's enough
- Form sharing/collaboration — single creator
- User accounts/auth — sessions are anonymous
- Multi-language UI — English only (Sarvam supports Hindi etc but we won't expose it)