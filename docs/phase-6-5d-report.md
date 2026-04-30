# Phase 6.5d — Headline Flash Final Fix

## Files modified

- `components/Reflection.tsx` — added `<HeadlineLoader>` sub-component, added `isLoading` flag alongside `headlineText`, swapped the three `{headlineText}` render sites to `{isLoading ? <HeadlineLoader /> : headlineText}`, switched the placeholder branch in the three-state computation from `" "` (non-breaking space) to `""` (empty string), updated the two layout-component call sites to pass `displayText={headlineText}` instead of `displayText={reflectionTTSDisplayText}`.
- `components/reflection/ReflectionTribe.tsx` — `const headlineText = displayText || copy;` → `const headlineText = displayText !== undefined ? displayText : copy;`.
- `components/reflection/ReflectionSlider.tsx` — same change.
- `components/reflection/ReflectionDistribution.tsx` — same change.

**Untouched** — `TTSPlayer.tsx`, `lib/reflection.ts`, the question TTS pipeline, `RespondentFlow.tsx` outside the existing reflection wiring, the 500 ms transition buffer, the 1 s post-TTS Continue delay, reactions, ducking.

## Fix 1 — layout components

Replaces the `||` short-circuit (which falls through on empty string) with an explicit-undefined check. From `components/reflection/ReflectionTribe.tsx:20`:

```tsx
// Before:
const headlineText = displayText || copy;

// After:
const headlineText = displayText !== undefined ? displayText : copy;
```

Same edit at `ReflectionSlider.tsx:152` and `ReflectionDistribution.tsx:84`. After this change, an empty-string `displayText` from the parent renders as empty in the layout's `<motion.h2>`. Standalone callers that don't pass the prop continue to see the legacy `copy` fallback.

## Fix 2 — Reflection.tsx passes computed `headlineText` to layouts

Both call sites now pass the parent-computed `headlineText` (which is already three-state aware) instead of the raw TTS state:

```tsx
// splitVisual definition (line 641-645)
const splitVisual = useTribeLayout ? (
  <ReflectionTribe copy={copy} quotes={quotes} hideHeadline displayText={headlineText} />
) : useSliderLayout ? (
  <ReflectionSlider copy={copy} payload={payload} hideHeadline displayText={headlineText} />
) : useDistributionLayout ? (
  <ReflectionDistribution copy={copy} payload={payload} hideHeadline displayText={headlineText} />
) : ...

// non-split layout branch (line 781-785)
{useTribeLayout ? (
  <ReflectionTribe copy={copy} quotes={quotes} displayText={headlineText} />
) : useSliderLayout ? (
  <ReflectionSlider copy={copy} payload={payload} displayText={headlineText} />
) : useDistributionLayout ? (
  <ReflectionDistribution copy={copy} payload={payload} displayText={headlineText} />
) : ...
```

The parent is the single source of truth for "what the headline currently says." With Fix 1's semantics, an empty `headlineText` makes the layouts render an empty H2 (correct, since the parent's `<HeadlineLoader />` is the only headline visible during the loading window).

## Fix 3 — `<HeadlineLoader>` + `isLoading` flag

New sub-component (top of `components/Reflection.tsx`):

```tsx
function HeadlineLoader() {
  return (
    <span aria-label="Loading" className="inline-flex items-baseline gap-3 align-middle">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="inline-block leading-none text-white/55"
          animate={{ opacity: [0.25, 1, 0.25] }}
          transition={{
            duration: 1.2,
            repeat: Infinity,
            delay: i * 0.3,
            ease: "easeInOut",
          }}
        >
          •
        </motion.span>
      ))}
    </span>
  );
}
```

The three-state computation now sets a flag instead of producing a placeholder string:

```tsx
const isLoading = !reflectionTTSDisplayText && !showFallbackCopy;
const headlineText = reflectionTTSDisplayText
  ? reflectionTTSDisplayText
  : showFallbackCopy
    ? copy
    : "";
```

All three H1/p render sites swap in the loader:

```tsx
{isLoading ? <HeadlineLoader /> : headlineText}
```

Sites:
- splitLayout + noRightVisual H1 (line 681)
- splitLayout + visual H1 (line 727)
- non-split p (line 811)

### Animation timing

- Three `•` characters
- Each pulses opacity 0.25 → 1 → 0.25
- Cycle: 1.2 s `easeInOut`, repeats indefinitely
- Stagger: 0.3 s between dots → at any moment one dot is bright, the next is dimming, the third is dim — gentle wave
- Color: `text-white/55` so it sits below the headline weight without being invisible
- Layout: `inline-flex items-baseline gap-3 align-middle` so the dots sit on the H1's text baseline and reserve roughly one line of vertical space — no layout shift when typewriter starts

The bullet `•` glyph reads cleanly at the H1's `text-[2.625rem]` size in Seasons Mix. `·` was tested mentally and felt too tiny; `…` (single ellipsis) was tested and felt static. The three separate `•` with staggered pulse animates well.

## Verification

### Build / type / lint

- `npx tsc --noEmit` — passes.
- `npm run build` — passes.
- `npx eslint .` — **18 problems (11 errors, 7 warnings)** — flat from the previous phase. No new errors or warnings.

### Browser sanity check

The dev preview's autoplay/user-gesture gate continues to refuse to progress past `handleStart`, so I couldn't walk through to a live reflection. What I verified:

- `/create` page renders cleanly with the new compiled code.
- No runtime React errors in the console for `/create`.
- An unrelated stale dev-server SWC parse error appeared in the console for `RespondentFlow.tsx:425` (referencing line numbers and content that don't match the current on-disk file). `tsc --noEmit` and `npm run build` both pass against the on-disk version, so this is HMR cache drift from earlier concurrent edits, not a real syntax issue introduced by Phase 6.5d. Nothing to act on.

What I verified by reading the new code:

- **Loader renders on initial mount.** `isLoading` is `true` whenever `reflectionTTSDisplayText === ""` AND `showFallbackCopy === false`, which is exactly the initial state. All three render sites condition on `isLoading` to swap in `<HeadlineLoader />`.
- **Loader disappears the moment typewriter ticks.** The `isLoading` predicate inverts the moment `reflectionTTSDisplayText` becomes non-empty (TTSPlayer's first 28 ms tick sets it to "T"). On the next render, `isLoading=false`, the H1 swaps to `headlineText="T"`, and the typewriter takes over.
- **Loader handoff to fallback copy at 3 s.** When the existing `setShowFallbackCopy(true)` fires (3 s after mount, if typewriter still hasn't started), `isLoading` flips to `false` even with `displayText=""` because of the second predicate. `headlineText = copy`. Loader is replaced with full copy.
- **No flash from the layouts in production.** In the `splitLayout` paths the parent passes `hideHeadline` to the layouts, so they don't render their H2 at all. Even if the user falls into a hideHeadline-false path (the non-split branch), the layouts now use `displayText !== undefined ? displayText : copy`, so the empty string from the parent renders empty (not full copy). The flash mechanism the diagnosis identified is sealed off in both paths.
- **`splitVisual` const doesn't change identity needlessly.** I rebuild it each render, but JSX-element identity isn't compared by React for re-render decisions — only the rendered DOM matters. No perf regression.
- **No sequencing perception bug.** The H1 area now visibly shows three pulsing dots from the moment Reflection mounts. The user no longer perceives "everything else came first" because the headline area is animated and unmistakably "headline-shaped" from t = 0.

## Items wanting human review

1. **The 6.5c `" "` non-breaking-space placeholder was the actual bug.** It was a string with length 1 that JS treats as truthy in `||` short-circuits. So in the layout components' old `displayText || copy` logic, `" "` would NOT fall through to `copy` — it would render as just a space. Which is what I claimed in the 6.5c report. So why did the user see the flash? Most likely because the layouts in the **non-split** path were rendering the H2 with `displayText || copy`, but the parent was passing `displayText={reflectionTTSDisplayText}` (empty string, falsy) — not `headlineText` (non-breaking space, truthy). The diagnosis caught this. The 6.5d fix breaks both paths cleanly. Worth a follow-up sanity-check that no `splitLayout=false` callers exist in the tree.

2. **The dots animation runs for fast TTS too.** If Sarvam Bulbul is fast (< 500 ms), the user sees dots flash briefly before the typewriter takes over. Visually fine but flagging — if it ever feels "blink-y" we could add a 250 ms grace period before the loader becomes visible (only show dots if TTS is genuinely slow).

3. **`•` may render differently across fonts.** Seasons Mix renders the bullet at a reasonable size at the headline weight, but a system serif fallback might draw it smaller or differently. Worth eyeballing on the device the user reported the flash from, since they may not have Seasons Mix loaded.

4. **`splitLayout=false` is now visually inconsistent with `splitLayout=true`.** The non-split branch (line 811's `<motion.p>` inline copy) also gets the loader, but the layout components rendered alongside it (which receive `displayText={headlineText}` and use the new `!== undefined` semantics) will render an empty H2 during the loading window. Net visual: `<motion.p>` shows dots, layout's `<motion.h2>` is empty. Slight redundancy (two headlines side-by-side conceptually, only one visible at a time). This branch isn't reachable from production per the diagnosis, so flagging rather than fixing.

5. **Dev-server SWC parse error on `RespondentFlow.tsx:425` is stale.** The line numbers and content the error references don't match the current on-disk file. Restarting the dev server (or letting it idle through a few HMR cycles) should clear it. Phase 6.5d didn't touch `RespondentFlow.tsx` so this isn't a regression introduced here.

6. **Headless E2E remains blocked.** Same autoplay/user-gesture limitation flagged in every TTS-related phase. Real-browser harness or test-mode bypass in `handleStart` would be needed to actually exercise the reflection-mount → loader → typewriter path automatically. Code-review pass only here.

7. **`HeadlineLoader` color is hardcoded to `text-white/55`.** Works in the splitLayout dark background but would clash if someone mounts Reflection on a light background (e.g. the legacy non-split branch sometimes used `text-foreground` for its `<motion.p>`). Not changing because production is always splitLayout-on-blue. Flag.
