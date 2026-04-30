# Phase 1 Report — Schema Design

## Decisions on ambiguous spec points

**`Identity.label` cross-validation.** Expressed via a factory: `identitySchemaFor(allowedLabels)` returns a refined schema bound to the form's archetype list. The base `identitySchema` validates only the structural shape; Phase 5 call sites are expected to fetch the form's archetypes first and invoke the factory before parsing LLM output. This keeps the structural schema reusable (e.g. for static type inference) while making the runtime constraint explicit and easy to apply.

**Name question phrasing.** Hardcoded as `NAME_QUESTION_PROMPT` in `lib/schemas.ts`, per the spec's recommendation. Stage A does not generate phrasing for it. The wording is identical across all forms, so spending an LLM call on it is wasteful and introduces variance for no benefit.

**`FormGenerationOutput` validation rules.** Used Zod's `.superRefine()` to encode (a) the Q1-is-name rule, (b) contiguous-position rule, (c) unique-archetype-label rule. These run as a single pass and emit specific issue paths. Position contiguity assumes the array is in order; if Stage A returns out-of-order positions, the rule fires for each offending index.

**`SeedAnswer` discriminated union shape.** Embedded `input_type` directly into each variant rather than nesting payloads under `value`. This matches `Question` (also discriminated on `input_type`) and keeps the LLM's job simpler — it produces a flat object with a tag, not a tagged wrapper around a payload.

## Edge cases considered

**Anonymous forms (`forms.anonymous = true`).** The schema for `FormGenerationOutput` still encodes the Q1-is-name rule via `superRefine`. Rather than fork the schema, the contract is that Phase 2's call site will run anonymous-mode validation with that rule skipped (e.g. by stripping the first `superRefine` issue, or by parsing against a relaxed copy). Documented in `docs/schemas.md` under "Planned database addition: `forms.anonymous`". An alternative — exposing both `formGenerationOutputSchema` and `anonymousFormGenerationOutputSchema` — was considered and rejected as schema sprawl for a single-bit difference.

**`SeedAnswer` cross-validation.** The Zod schema enforces the structural shape (e.g. `cards.selected` is a non-empty string) but cannot verify membership in the corresponding question's `options` because the question list is not in scope for a per-answer schema. The `docs/schemas.md` "Cross-validation (runtime, not Zod)" subsection documents this; it is the seed-insertion job's responsibility in a later phase.

**Visual-select `image_url`.** Currently validated as `z.string().url()`. Stage A is expected to use stable, public image URLs (e.g. Supabase storage). If image generation moves to data URIs or asset references, this constraint must relax — flagged for review.

**Empty `voice` / `text` transcripts.** `min(1)` enforced. If a persona's stance is "refuses to answer", Stage C must still produce a non-empty transcript (e.g. `"I'd rather not say."`). This is a prompt concern, but the schema rules out the trivially empty case.

## Items wanting human review

1. **Anonymous-mode validation strategy.** I documented the runtime-toggle approach but did not fork the schema. If Phase 2 prefers a separate `anonymousFormGenerationOutputSchema`, this should be decided before the call site is built.
2. **`Identity` no-fallback policy.** The current production code has a "Quiet Observer" fallback in `app/api/complete-session/route.ts`. The spec says no generic fallback — confirming this means UX has to design an error state for completion. Flagging for product review.
3. **`Persona.archetype_label` cross-check.** Like `Identity.label`, this can't be statically encoded. I did **not** add an `personaSchemaFor(labels)` helper because Stage B's call site already has the archetype list in hand and a one-line check is simpler than a configured schema. Easy to add if a Phase 3 reviewer wants symmetry with Phase 5.
4. **`indicator_signals` typing.** I left this as `string[]` rather than a structured `{ kind: "phrase" | "behavior", text: string }[]`. The spec didn't differentiate, and adding structure now would be future-proofing without a use case.

## Verification

- `npx tsc --noEmit` — passes (exit 0).
- `npm run build` — passes; no regressions from this phase.
- A small `tsx` smoke test confirmed runtime behaviour: valid forms parse, invalid positions are rejected, valid seed responses parse, `identitySchemaFor` accepts known labels and rejects unknown ones.
- Existing types in `lib/types.ts` were not modified. There is one notional conflict — `lib/types.ts` defines `InputType` without `"name"`, since the existing flow has not added it yet. Phase 2 (or whichever phase introduces the name input at runtime) will need to widen that type. Documented here rather than fixed.

---

## Phase 1 Adjustment

Two follow-up changes after the initial submission.

### 1. Anonymous-mode handling: factory instead of runtime toggle

Replaced the static `formGenerationOutputSchema` with a `formGenerationOutputSchemaFor({ anonymous })` factory in `lib/schemas.ts`, mirroring the `identitySchemaFor` pattern. The previous "skip the rule at the call site" approach was brittle — it pushed validation responsibility outside the schema layer. The factory now owns mode selection.

- Non-anonymous variant enforces all three rules (Q1-is-name + position 0, contiguous positions, unique archetype labels).
- Anonymous variant enforces only the latter two; Q1 may be any input type, position must still be 0.
- Both variants share the same TypeScript shape, so `FormGenerationOutput` is still derived once (from the non-anonymous variant) and exported.
- A convenience `formGenerationOutputSchema` constant is kept as an alias for the non-anonymous variant so type inference and any downstream "default" parses keep working without a behaviour change.

`docs/schemas.md` was updated: the anonymous-mode section now describes the factory directly, with an example call.

### 2. `lib/types.ts InputType` widened to include `"name"`

Added `"name"` as the first member of the `InputType` union in `lib/types.ts`, matching the schema-layer enum.

### TypeScript fallout from change (2)

`npx tsc --noEmit` and `npm run build` both fail with **one** error after this change, in line with the prompt's expectations:

- `app/create/page.tsx:58` — `INPUT_TYPE_LABELS: Record<InputType, string>` is missing the `"name"` key. This is structurally the same problem as a non-exhaustive switch (an exhaustiveness check over `InputType`), so per the prompt's guidance I left it for a later phase to address.

Per the prompt: not modifying it. Phase 2 / Phase 6 owns it.

For reference, other code locations that switch on `input_type` and may need a `case "name":` clause when name is wired up at runtime:

- `app/api/answers/route.ts:189` — `case "cards"` block (no `default`/exhaustiveness guard, currently silent).
- `app/api/answers/route.ts:215–216` — `case "voice" / case "text"` block.
- `scripts/seed.ts:397` — `switch (q.input_type)` with cases for `voice`, `text`, `cards`, etc.

These three did not surface as TypeScript errors (the switches are not exhaustiveness-checked), so they are not blocking the build. Listed here as a hint to the Phase 2/6 implementer rather than as failures.

### Verification (post-adjustment)

- `npx tsc --noEmit` — fails with the single `INPUT_TYPE_LABELS` error above; no other regressions.
- `npm run build` — fails on the same single error; nothing else.
- `lib/schemas.ts` — `formGenerationOutputSchemaFor` exported as factory; `formGenerationOutputSchema` retained as alias for the non-anonymous variant.
- `docs/schemas.md` — anonymous-mode and `FormGenerationOutput` sections updated to reflect the factory.
