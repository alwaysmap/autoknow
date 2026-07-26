---
title: A chart label placed at a data-derived coordinate collides on the HEALTHY dataset, so the seeded demo never shows you the bug
status: current
updated: 2026-07-26
applies_to:
  - src/components/CapacityChart.tsx
  - src/components/CycleTimeScatterPlot.tsx
  - src/components/ChainSchedule.tsx
  - src/lib/labelPlacement.ts
  - any new SVG `<text>` / `<ChartLabel>` whose x or y comes from a datum
symptoms:
  - two chart captions print on top of each other and both become unreadable
  - a chart label is missing, and the value it named appears nowhere else
  - a label sits outside the plot box, past the axis or off the top of the SVG
  - a label is clipped by the frame, while every de-collision test is green
  - the chart looks perfect against seeded data and wrong against a real program
verified_by: 'tests/labelCollisionSweep.test.tsx (p50 === p85, five thin capacity bands, seeded PRNG corpus, the buffer flow blown, above B₀, and with today at the right edge); issue #161 sweep + step 2/4; before/after screenshots in both themes'
---

Placing a label at a data-derived coordinate delegates its legibility to the data: it
reads fine until two points come close, and then BOTH labels are destroyed — not one.
The #161 sweep found ten files drawing labels and one de-colliding them.

**Why it bites.** The dataset that crowds is usually the *good* one, so neither the demo
seed nor a screenshot review will show it to you. `CycleTimeScatterPlot` drew `P50` and
`P85` at each percentile's own x, same baseline: a tight distribution — a healthy,
predictable phase — printed them on one pixel and deleted the median. `CapacityChart`'s
band labels sat at their midpoints, so thin adjacent bands stacked into mush.

**What to do.**

1. Any new label at a data-derived coordinate goes through `src/lib/labelPlacement.ts`
   before it renders, with `estimateTextWidth` for `halfW` — measuring needs a DOM, and
   a layout that needs a DOM is neither pure, server-safe, nor unit-testable.
2. **Choosing the strategy is a semantic call, not a style one.** `keepNonOverlapping`
   HIDES the loser — correct only where the reader recovers the value elsewhere (an axis
   tick is still readable off the scale). `dodgeLabels` NUDGES in y and keeps all —
   correct where the label is the only place a fact appears. Ask "if this label vanished,
   could the reader still get the number?" A hover readout does not count: not there at rest.
3. **Never resolve a collision by shrinking type.** `ChainSchedule.tsx`'s sizes
   (`FS_ROW`/`FS_EMPH` 12, `FS_AXIS` 11, `FS_SMALL` 10) were raised once for legibility
   (#83); a de-collider that undoes that is a regression in disguise. Hand-rolled
   push-apart loops are the other trap: `CapacityChart`'s pushed only *upward* with no
   bounds and walked thin top bands' labels off the plot. `dodgeLabels` clamps.
4. Drive the test from a fixture chosen to crowd, and prove the detector can see a
   collision before trusting it to report none.
5. Assert the FRAME too: a reading anchored to today's right ran off the viewBox (today
   sits hard against the right edge whenever a program finishes near its SOP). Flip the
   anchor side on the measured width, and assert the bound — the de-collider never will.
6. Everything above is label-on-LABEL. Label-on-INK — a gridline or the chart's own
   line through a caption — is a different failure with the same green tests:
   [A placement pass clears the labels you pass it, never the ink you didn't](a-placement-pass-clears-labels-not-the-ink-you-did-not-pass.md).

**Still open.** `src/lib/hillLayout.ts` carries a second de-collider and
`ChainSchedule.tsx` a private `estimateTextWidth` — "the de-collider" is not yet one
thing, so check which one a chart uses before adding a third.
