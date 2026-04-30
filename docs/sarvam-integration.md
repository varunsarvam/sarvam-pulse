# Sarvam API Integration Reference

All Sarvam calls are server-side only, in lib/sarvam.ts and called from API routes.

## Authentication

Header: `api-subscription-key: ${SARVAM_API_KEY}` for all calls (STT, TTS, LLM). Used uniformly in `lib/sarvam.ts` and the route handlers.

## Endpoints we use

### Speech-to-Text

POST [https://api.sarvam.ai/speech-to-text](https://api.sarvam.ai/speech-to-text)

Content-Type: multipart/form-data

Body fields:

- file: audio file (webm/wav/mp3 supported; webm from MediaRecorder works)
- model: "saarika:v2.5"
- language_code: "en-IN"

Response: { transcript: string, language_code: string }

### Text-to-Speech

Implemented via the official `sarvamai` SDK in `app/api/tts/route.ts`, using
`client.textToSpeech.convertStream(...)`. The route returns an `audio/mpeg`
stream directly to the browser (no base64 round-trip).

Parameters:

- `model`: `"bulbul:v3"`
- `target_language_code`: `"en-IN"`
- `output_audio_codec`: `"mp3"`
- `output_audio_bitrate`: `"24k"`
- `pace`: `1.0`, `pitch`: `0`, `loudness`: `1.2`

Voice mapping by tone (authoritative — see `TONE_VOICE` in `lib/sarvam.ts`):

- `playful` → `"anushka"`
- `calm` → `"neha"`
- `direct` → `"rahul"`
- `insightful` → `"varun"`

NOTE: The older `textToSpeech()` helper that did a direct fetch + base64 decode
has been removed from `lib/sarvam.ts`. The route handler is the only TTS
caller.

### LLM (Chat Completion)

POST [https://api.sarvam.ai/v1/chat/completions](https://api.sarvam.ai/v1/chat/completions)

Content-Type: application/json

Body (OpenAI-compatible shape):

{

  "model": "sarvam-105b",

  "messages": [{ "role": "system", "content": "..." }, { "role": "user", "content": "..." }],

  "temperature": 0.7,

  "max_tokens": 200

}

Response: OpenAI-compatible. Read `data.choices[0].message.content`.

Available models (use sarvam-105b by default):

- "sarvam-105b" — flagship 105B param MoE, 128K context. Best quality, slower. DEFAULT for all LLM tasks.
- "sarvam-30b" — mid-tier, 64K context. Faster. Use only if 105B is too slow on the question-phrasing hot path.
- "sarvam-30b" — 30B model. Use for phrase-question, follow-up, normalize routes.

If the chat endpoint path returns 404, check the Sarvam dashboard playground for the current shape.

## Failure modes and fallbacks

| Failure | Fallback |

|---|---|

| STT 4xx/5xx | Show "I didn't catch that — try typing instead" + switch to text input |

| STT returns empty transcript | Same as above |

| TTS fails | Skip audio, just show the text — don't block the flow |

| LLM phrase-question fails | Use the original (creator-written) question text |

| LLM normalize fails | Save answer with normalized=null, sentiment=0, skip cluster updates this turn |

| LLM follow-up fails | Skip the follow-up, proceed to reflection |

The product MUST work even when Sarvam is partially down. Voice input failure should never block submission.

## Cost discipline

For the demo:

- TTS is the most expensive per character. Cache audio buffers per question text.
- STT is per-second. Set max recording duration to 30 seconds in the UI.
- LLM calls: cache phrase-question results in memory. Don't re-phrase the same question.