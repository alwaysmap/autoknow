---
title: A placement pass clears the labels you pass it, never the ink you didn't — a rule's caption is not the rule
status: current
updated: 2026-07-26
applies_to:
  - src/lib/labelPlacement.ts
  - src/components/ChainSchedule.tsx
  - src/components/CapacityChart.tsx
  - src/components/CycleTimeScatterPlot.tsx
  - any chart drawing a gridline, threshold, boundary or crosshair behind a label
symptoms:
  - a gridline or the chart's own line runs straight through a label while every de-collision test is green
  - a label sits pinned exactly on the line it was placed a fixed offset away from
  - a vertical rule (today, a threshold, the crosshair) runs through a chart caption
  - a collision that reproduces only for data at one end of the axis
verified_by: 'tests/labelCollisionSweep.test.tsx — "keeps every flow label off every gridline" (healthy / blown / above-B₀) and "never runs a vertical rule through the flow caption"; all four fail on the pre-fix ChainSchedule and pass on the fix; screenshots in both themes, issue #161 step 2/4'
---

# A placement pass clears the labels you pass it, never the ink you didn't

`keepNonOverlapping` and `dodgeLabels` are pure box arithmetic. They clear exactly the
boxes handed to them, and a chart's gridlines, thresholds, boundary polyline and
crosshair are not boxes anybody hands them — so the pass reports clear and the screen
shows a rule through the reading. Every test built on the same boxes agrees with it.

**Why it bites.** The rules usually DO appear in the anchor set — as their captions. A
gridline is painted edge to edge across the plot, but its tick label is a ~30px box in
the left gutter, and `overlaps()` needs an x overlap: nothing inside the plot can ever
hit it. `ChainSchedule`'s buffer flow shipped "115% left · 157d" centred on the 100%
rule with the tick for that rule passed as an anchor. Worse, the intended clearance —
a fixed offset from the boundary — is not clearance at all: `dodgeLabels` CLAMPS to its
`YBounds`, so wherever the line rides within a label-height of the plot edge, the clamp
puts the label straight back onto it, dead centre.

**What to do.**

1. Pass the ink. A full-width rule goes in as a full-width fixed box (`x` at the plot's
   centre, `halfW` = half the plot); a sloping line goes in per label as the y range it
   covers across THAT label's own width. Half the heaviest stroke plus a hair is enough
   `halfH` — over-reserving costs a few px of dodge, under-reserving is silent.
2. Keep ink out of `keepNonOverlapping`. It HIDES losers, and a rule that hides its own
   tick label is a worse chart than one with a tight label.
3. State the trigger geometrically, not from the data. This one was "the boundary is in
   the frame's top pad" — true of every buffer at or above B₀ — and a fix keyed on
   `leftPct === 100` misses the 115% program that reproduced it. A data predicate
   standing in for a geometry question (`hasBufferAtNow` for "is there room above the
   line") is the shape of this mistake.
4. Vertical ink is the one collision no pass can fix, because they all nudge in y. CUT
   the rule around the caption's box instead; moving the caption cannot work, because a
   crosshair arrives at any x.
5. Test against the RENDERED ink — read the `<line>` and `<polyline>` elements back out
   and intersect them with the label boxes. Convert first: an SVG `<text>` carries a
   BASELINE and a rule's y is already a CENTRE, so the reader must go through
   `baselineToCentreY` (`boxOf` now does). Label-on-label survives that mismatch — same
   size, same shift, it cancels — and label-on-ink does not.

**How we found out.** The flow's three collisions were read off a screenshot after the
component's own collision sweep went green — twice. The gridline check, added afterwards,
fails on the *healthy* fixture too, so it was never the 115% program's own bug.
