# Reflection Headline Flash — Diagnosis

**Scope:** read-only investigation. No code changes.

## TL;DR

There is **one primary bug + one design oversight + one perception issue** that together explain the user's report.

1. **Primary bug** — the three layout components (`ReflectionTribe`, `ReflectionSlider`, `ReflectionDistribution`) compute `headlineText = displayText || copy`. With `displayText === ""` (the state on mount), the `||` operator falls through and they render the **full `copy`** in their H2. This is what shows the flash.
2. **Why splitLayout masks it half the time** — in `splitLayout` mode (production) the parent passes `hideHeadline` to the layouts, suppressing their H2. The flash only manifests in the `splitLayout=false` path *or* in `splitVisual` paths that don't actually hide the headline. There's a subtle case below where this breaks.
3. **Sequencing perception (item 5 in the report)** — emoji bar + white right card don't depend on TTS so they're visible immediately on mount. The H1 holds a non-breaking space (`" "`) until TTS starts ticking, which can be 1–3 s on Sarvam. So the user sees "everything except the headline" for a noticeable beat. That's not a bug per se — it's the spec'd behaviour — but it reads as "headline came last."

The flash itself is **not** in the parent's H1 (line 644/690 of `Reflection.tsx`), which correctly renders the `" "` placeholder. It's downstream — in the layout components.

---

## 1. Render trace — every site that renders the reflection headline

`components/Reflection.tsx` after the 6.5c diff has three branches. I'll paste each one verbatim:

### Branch A — `splitLayout` + `noRightVisual` ([line 627–671](components/Reflection.tsx:627))

```tsx
if (noRightVisual) {
  return (
    <div className="flex min-h-screen w-full items-center justify-center p-5 md:p-8" ...>
      {ttsPlayer}
      <div className="flex w-full max-w-3xl flex-col items-center gap-7 px-6 text-center md:px-12">
        <motion.h1
          className="font-display text-[2.625rem] leading-tight tracking-tight text-white md:text-[3.375rem]"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: "easeOut" }}
        >
          {headlineText}        // ← uses headlineText (= " " on mount). NOT FLASHY.
        </motion.h1>
        <EmojiBar reacted={reacted} onReact={handleReaction} dark center />
        ...
```

**Verdict for this branch: not the flash source.** `headlineText` evaluates to `" "` on mount, so the H1 renders an invisible space.

### Branch B — `splitLayout` + a real visual (the production path most of the time) ([line 674–724](components/Reflection.tsx:674))

```tsx
return (
  <div className="flex min-h-screen w-full -translate-y-6 flex-col gap-6 p-5 md:-translate-y-8 md:flex-row md:p-8" ...>
    {ttsPlayer}
    <div className="flex w-full flex-col justify-center gap-7 px-8 pt-16 md:w-[55%] md:px-14 md:pt-0">
      <motion.h1 ... transition={{ duration: 0.45, ease: "easeOut" }}>
        {headlineText}        // ← left H1: " " on mount, NOT FLASHY
      </motion.h1>
      {!useSliderLayout && (<EmojiBar ... dark />)}
    </div>
    <div className="flex w-full items-center justify-center md:w-[45%]">
      <div className="relative ... bg-white ...">
        {splitVisual}         // ← right card: layout component with hideHeadline
        ...
      </div>
    </div>
  </div>
);
```

`splitVisual` is built at [line 605–623](components/Reflection.tsx:605):

```tsx
const splitVisual = useTribeLayout ? (
  <ReflectionTribe copy={copy} quotes={quotes} hideHeadline displayText={reflectionTTSDisplayText} />
) : useSliderLayout ? (
  <ReflectionSlider copy={copy} payload={payload} hideHeadline displayText={reflectionTTSDisplayText} />
) : useDistributionLayout ? (
  <ReflectionDistribution copy={copy} payload={payload} hideHeadline displayText={reflectionTTSDisplayText} />
) : (
  <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} ...>
    {type === "comparison" && <ComparisonVisual payload={payload} />}
    {type === "majority" && <MajorityVisual payload={payload} />}
    {type === "minority" && <MinorityVisual payload={payload} />}
    {type === "tribe" && <TribeVisual payload={payload} />}
  </motion.div>
);
```

`hideHeadline` IS passed when the visual is a `ReflectionTribe`/`ReflectionSlider`/`ReflectionDistribution` layout. So in those cases the layouts' H2 is suppressed (gated by `!hideHeadline` in the layout — see below). The fallback `motion.div` branch renders a non-text visual (`ComparisonVisual` etc.), no copy.

**Verdict for this branch: not the flash source IF the layout is one of the three with `hideHeadline=true`.** Which is always true here.

### Branch C — non-split (legacy) layout ([line 727–end](components/Reflection.tsx:727))

```tsx
return (
  <>
    {type === "emotion" && ... && <EmotionWash ... />}
    <div className="..." ...>
      {ttsPlayer}
      {useTribeLayout ? (
        <ReflectionTribe copy={copy} quotes={quotes} displayText={reflectionTTSDisplayText} />
        // ↑ HERE — no hideHeadline. Layout will render its H2 with displayText || copy.
      ) : useSliderLayout ? (
        <ReflectionSlider copy={copy} payload={payload} displayText={reflectionTTSDisplayText} />
      ) : useDistributionLayout ? (
        <ReflectionDistribution copy={copy} payload={payload} displayText={reflectionTTSDisplayText} />
      ) : (
        <>
          <motion.div ...>... visuals ...</motion.div>
          <motion.p ... transition={{ delay: 0.2, duration: 0.25 }}>
            {headlineText}    // ← uses headlineText (= " "), NOT FLASHY
          </motion.p>
        </>
      )}
      ...
```

**This is the flash source.** When the parent calls `<ReflectionTribe ... displayText={reflectionTTSDisplayText} />` without `hideHeadline`, the layout renders its H2 with `displayText || copy`. With `displayText = ""` on mount → `"" || copy === copy` → **full copy in the H2**.

`<Reflection splitLayout>` is the only call site in `RespondentFlow.tsx` ([line 1525](app/respond/[formId]/RespondentFlow.tsx:1525)), so this branch shouldn't run in production. But see Section 5 below — there is a way it can.

### The layout components — the actual mechanism

All three look the same. From [`ReflectionTribe.tsx:18–30`](components/reflection/ReflectionTribe.tsx:18):

```tsx
export function ReflectionTribe({ copy, quotes, hideHeadline = false, displayText }: ReflectionTribeProps) {
  const visibleQuotes = quotes.slice(0, 3);
  const headlineText = displayText || copy;        // ← BUG: empty string falls through to copy

  return (
    <div className="flex w-full flex-col items-center">
      {!hideHeadline && (
        <motion.h2 ...>{headlineText}</motion.h2>   // ← would render full copy on mount
      )}
      ...
```

`ReflectionSlider.tsx:150` and `ReflectionDistribution.tsx:82` are identical: `const headlineText = displayText || copy;`.

**The bug:** `||` treats the empty string `""` as falsy, so when the parent passes the raw `reflectionTTSDisplayText` (which starts as `""`), the layout computes `headlineText = copy` and renders the full string. The 6.5c diff fixed this **only** in `Reflection.tsx`'s own `headlineText` (which uses the three-state `" "` placeholder), but it **did not fix it in the layout components**, which still use the old `||` short-circuit.

The fix in 6.5c relied on `hideHeadline=true` always being passed when the parent uses splitLayout. Which is true today. So branch B is currently safe. But the assumption is fragile.

---

## 2. Mount sequence — frame-by-frame

For a typical reflection in the production splitLayout-with-visual path (Branch B above):

| Time | What renders / runs | What the user sees |
|---|---|---|
| t = 0 (commit) | `<Reflection>` mounts. State inits: `reflectionTTSDisplayText = ""`, `showFallbackCopy = false`, `reflectionTTSDone = false`. | Wrapping `motion.div key="reflection"` is at `opacity: 0` (fadeUp initial). Nothing visible yet. |
| t = 0 + paint | Inside Reflection: `headlineText = " "`. JSX is built. Branch B selected. `splitVisual` computed (layout component with `hideHeadline`). | Container fades in over 450 ms (parent's `fadeUp` variant). |
| t ≈ 0–450 ms | `<motion.h1>` initial = `{ opacity: 0, y: 10 }`, animate = `{ opacity: 1, y: 0 }`, content = `" "`. Right-side white card has no `initial` prop, so it's visible immediately. EmojiBar has `delay: 0.5` so it's invisible until t = 500 ms. | Left H1 fades in but content is invisible. **Right card visible, content visible (quotes/visual/etc.). Headline area is empty.** |
| t ≈ 0 (effect tick) | TTSPlayer mounts. `loadAndPlay()` runs. Synchronously: `onDisplayedTextChange("", false)` → `setReflectionTTSDisplayText("")`. State already `""`, React no-ops, no re-render. | No visible change. |
| t ≈ 0 (effect tick) | `useEffect([])` for fallback copy: schedules 3 s timer. | No visible change. |
| t ≈ 0–~2 s | TTSPlayer awaits `fetch("/api/tts")`. Sarvam Bulbul TTS responds in ~1–3 s. | **User stares at a card with right-side content but no headline.** EmojiBar fades in at 500 ms. |
| t ≈ ~2 s | Audio blob ready, `audio.src` set, `audio.play()` called. `audio.onplay` fires. Typewriter starts. First tick (28 ms later): `setReflectionTTSDisplayText("T")`. Re-render. `headlineText = "T"`. H1 shows "T". | **First character pops in.** Typewriter continues every 28 ms. |
| t ≈ ~2 s + n × 28 ms | Per tick, `displayText` grows. `headlineText` grows. H1 shows progressively more text. | Text reveals character-by-character, synchronized with audio. |
| t = ~2 s + audio duration | `audio.onended` fires. `onDisplayedTextChange(text, true)`. State: `displayText = full text`, `done = true`. | H1 shows full copy. |
| t = ~2 s + audio + 1 s | Continue button effect fires. `setShowContinue(true)`. | Continue button fades in. |

**No "full copy → empty → typewriter" sequence happens in this trace.** The headline goes empty → "T" → "Th" → … → full text. The user's report doesn't match Branch B's render flow.

What DOES match the user's report is Branch C, where:
- t = 0: layout component renders H2 with `displayText || copy = copy` → **full copy visible**.
- t = ~2 s: TTSPlayer's first typewriter tick → `displayText = "T"`. Layout re-renders with `displayText || copy = "T"` → **headline becomes "T"**, looks like "text disappeared and typewriter restarted."
- t = ~2 s + ticks: typewriter ticks normally.

So the user is hitting Branch C, not Branch B.

---

## 3. Suspected root cause

**Two convergent issues:**

### Cause A (primary, very likely) — layout components fall through `||` on empty string

[`ReflectionTribe.tsx:20`](components/reflection/ReflectionTribe.tsx:20), [`ReflectionSlider.tsx:150`](components/reflection/ReflectionSlider.tsx:150), [`ReflectionDistribution.tsx:82`](components/reflection/ReflectionDistribution.tsx:82) — all three compute `const headlineText = displayText || copy;`.

The 6.5c diff fixed `Reflection.tsx`'s parent H1 to use a non-breaking-space placeholder, but **didn't update the layout components' `||` semantics**. They still treat empty-string `displayText` as "no override → use copy."

### Cause B — `splitLayout` should mask Cause A, but there's a subtle exit window where it doesn't

In Branch B, `splitVisual` is computed **before** the JSX is rendered. Look at [line 605–610](components/Reflection.tsx:605):

```tsx
const splitVisual = useTribeLayout ? (
  <ReflectionTribe copy={copy} quotes={quotes} hideHeadline displayText={reflectionTTSDisplayText} />
) : ...
```

`hideHeadline` IS passed. So in Branch B, layouts have `hideHeadline=true` and don't render the H2.

But the user could still hit Cause A through one of these paths:

1. **A reflection where none of the three layouts apply.** Specifically, `useTribeLayout`, `useSliderLayout`, `useDistributionLayout` all evaluate to `false`. Then `noRightVisual = true` and Branch A is used (which uses `headlineText` correctly). So no flash here.

2. **The non-split fallback (Branch C).** Production passes `splitLayout` so this branch shouldn't run, but if a future caller forgets the flag — or there's a JSX rendering quirk during framer-motion exit — Branch C would render the layout's H2 with the broken `||`.

3. **The `splitLayout=false` path is reachable via FollowUp**? Actually no, the FollowUp path doesn't render a Reflection. The only Reflection call site is the REFLECTION stage.

So Cause A is dormant in the current production tree, but **it's a one-prop-omission away from manifesting**, and any test environment that renders Reflection without `splitLayout` (a Storybook story, an isolated test page, a future iteration) hits it instantly.

### Cause C (the user's report sentence about "appears with full copy briefly") — alternative explanation

If the user is genuinely seeing full-copy-then-empty-then-typewriter on splitLayout, the only paths I can identify in the current code that would set `reflectionTTSDisplayText` to the full copy first are inside `TTSPlayer.tsx`:

- [Line 82](components/TTSPlayer.tsx:82): if `/api/tts` returns a non-OK response, fires `onDisplayedTextChange(text, true)` → full copy + done.
- [Line 133](components/TTSPlayer.tsx:133): `audio.onended` (after audio finishes naturally).
- [Line 146](components/TTSPlayer.tsx:146): `audio.onerror` (audio failed).
- [Line 159](components/TTSPlayer.tsx:159): the catch block when `audio.play()` rejects (e.g. autoplay blocked).

Of these, **the audio.play() rejection path is the one that could fire on mount before any typewriter tick.** If the browser blocks autoplay (no recent user gesture, or the muted state interacts oddly with the new TTSPlayer mount), `audio.play()` rejects → catch → `onDisplayedTextChange(text, true)` → state flips to full copy + done → H1 shows full copy → Continue appears 1 s later.

In that scenario the typewriter would NOT fire at all (audio never played). So this doesn't fully match the user's "typewriter starts from empty and animates" — unless they're describing the **next** reflection's behaviour, not the current one.

### Cause D (sequencing — item 5 in the user report)

The user separately reports **"emoji bar + right-side visual elements appear BEFORE the headline."**

This is true and is the spec'd behaviour:
- Right-side white card: no `initial` motion props → visible at t = 0 (limited only by parent fadeUp).
- Right-side visual (quotes/chart/etc.): has its own staggered `initial/animate` but nothing gates it on TTS.
- EmojiBar: `delay: 0.5` from mount. Visible at t ≈ 500 ms.
- H1 with `headlineText = " "`: visible from mount but content is invisible until typewriter ticks (t ≈ 1–3 s).

So the user perceives: card → visual → emoji bar → headline (eventually). It looks "out of order" because the headline is the slowest thing to populate. The non-breaking-space placeholder reserves the line height but doesn't visually telegraph "headline coming." Users read this as "the supporting elements arrived first."

---

## 4. What I'd change to fix it (no code edits made)

**Fix A — make the layouts ignore empty-string `displayText`.** Change the layouts' `||` to either a tri-state check or a strict-undefined check:

```tsx
// Before:
const headlineText = displayText || copy;

// After (option 1 — explicit-undefined):
const headlineText = displayText !== undefined ? displayText : copy;

// After (option 2 — match parent's three-state):
const headlineText = displayText && displayText.trim() ? displayText : copy;
```

Option 1 makes `displayText=""` an explicit "render nothing" signal. The parent then needs to pass `displayText={undefined}` (or skip the prop) when it wants the legacy `copy` fallback, and `displayText=""` when it wants intentional emptiness.

Option 2 is a smaller diff — treats whitespace-only displayText as "no override," matches the parent's `" "` placeholder semantics. Has the side effect that the layouts couldn't ever render whitespace-only headlines, but that's fine because the parent's three-state computation already produces `" "` only when waiting for TTS.

In both cases, also pass `headlineText` from parent down to the layouts (instead of the raw `reflectionTTSDisplayText`) so the layouts inherit the same three-state computation:

```tsx
const splitVisual = useTribeLayout ? (
  <ReflectionTribe copy={copy} quotes={quotes} hideHeadline displayText={headlineText} />
) : ...
```

That makes the parent the single source of truth for "what the headline currently says." The layouts just render whatever the parent computed.

**Fix B — give the user a visual signal that "headline is coming."** Right now the H1 area is invisible for ~1–3 s. A 1-line skeleton bar (low-contrast pill in the H1's place, fading in then fading out when the typewriter starts) would tell users "headline incoming" and remove the "everything else came first" perception. Out of scope for the fix to issue 1, but worth considering as a 2-line follow-up.

**Fix C — defensively set `displayText` to the parent's `headlineText` everywhere.** Even with Fix A, the parent passes `displayText={reflectionTTSDisplayText}` in two of the three layout call sites (the `splitVisual` const at line 605 and the non-split branch at line 745). Both should be `displayText={headlineText}`. This is a one-character-per-call-site change and removes any future drift if `hideHeadline` ever becomes false.

---

## 5. Why item 2 (emoji bar + right card appearing first)

Two compounding reasons:

1. **The right-side card has no entrance animation.** [Line 697](components/Reflection.tsx:697) renders `<div className="relative flex w-full max-w-2xl flex-col ...">` with no `motion.div` wrapper at the card level. It's plain JSX, visible from the moment the parent's `motion.div key="reflection"` finishes its fadeUp (t ≈ 450 ms after stage flip). The H1 also fades in over 450 ms but its content is `" "` until typewriter ticks.

2. **TTS load latency is 1–3 s.** Until `audio.onplay` fires, `reflectionTTSDisplayText` stays `""`, so `headlineText` stays `" "`. The H1 looks empty.

3. **Right-side visual content has its own animations, but they're not gated on TTS.** `<ComparisonVisual>`, `<MajorityVisual>`, etc. animate themselves into view 200–500 ms after mount. Quotes in `<ReflectionTribe>` stagger in starting at t = 600 ms. The user sees these arrive at clearly-discernible times. The headline arrives much later (t = 1–3 s) and only then starts revealing characters one at a time.

So the visual order is: parent panel fades in → right card visible → right-side animations play → emoji bar fades in at 500 ms → … nothing for 1–2 s in the H1 area … → typewriter starts. The user is correctly observing this ordering.

If we wanted the headline to feel "first" we'd need to either (a) pre-fetch reflection TTS during the question-stage answer-submit (~2 s window), or (b) show a deliberate "loading the headline" treatment in the H1 area instead of an invisible space. Neither is in scope for the current bug — flagging for the next iteration.

---

## Summary

- **Confirmed flash bug**: the three layout components' `displayText || copy` short-circuit. Currently masked in production by the `splitLayout`'s `hideHeadline=true` flag. Reachable in non-split render paths or any future caller that forgets the flag.
- **Likely root cause of the user's report**: they're hitting either (a) the non-split branch directly, (b) the `audio.play()` rejection path in TTSPlayer that sets full-copy + done immediately, or (c) describing a perception of "supporting elements first, headline last" that is exactly the spec'd waiting behaviour for slow TTS.
- **Smallest fix**: change the layouts' `displayText || copy` to `displayText !== undefined ? displayText : copy` AND have the parent pass `displayText={headlineText}` (the three-state computed value) in both the `splitVisual` definition and the non-split layout calls. Two ~3-character changes per file. Doesn't require touching `TTSPlayer.tsx` or the parent's effect logic.
- **Verification path I couldn't take**: live browser test. The dev preview's autoplay/user-gesture gate (documented in `docs/tts-fix-report.md` and earlier reports) blocks `handleStart` so I can't actually walk through to a reflection in the headless harness. Confirming the user's exact observation requires either a real-browser harness or a test seam in `handleStart`.
