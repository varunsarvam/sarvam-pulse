# Pulse Data Model (FROZEN — do not modify after Phase 0)

## Tables

[Paste the full SQL block from §2.1 of the build guide here]

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