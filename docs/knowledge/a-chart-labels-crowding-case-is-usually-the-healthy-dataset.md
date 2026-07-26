---
title: A chart label placed at a data-derived coordinate collides on the HEALTHY dataset, so the seeded demo never shows you the bug
status: current
updated: 2026-07-25
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
  - the chart looks perfect against seeded data and wrong against a real program
verified_by: 'tests/labelCollisionSweep.test.tsx (p50 === p85, five thin capacity bands, seeded PRNG corpus); issue #161 sweep; before/after screenshots in both themes'
---

Placing a label at a data-derived coordinate silently delegates its legibility to
the data. It reads fine until two data points come close, and then BOTH labels are
destroyed — not one. The sweep for #161 found ten files drawing labels and only
`labelPlacement.ts` de-colliding them.

**Why it bites.** The dataset that crowds is usually the *good* one, so neither the
demo seed nor a screenshot review will show it to you. `CycleTimeScatterPlot` drew
`P50` and `P85` at each percentile's own x, same baseline: a tight distribution —
i.e. a healthy, predictable phase — printed them on the same pixel and deleted the
median from the chart. `CapacityChart`'s five band labels sat at their bands'
midpoints, so thin adjacent bands (an early program, before any one product
dominates) stacked into mush. Both charts are at their least readable exactly when
the program is at its healthiest.

**What to do.**

1. Any new label at a data-derived coordinate goes through `src/lib/labelPlacement.ts`
   before it renders. Use `estimateTextWidth` for `halfW` — measuring needs a DOM, and
   a layout that needs a DOM is neither pure, server-safe, nor unit-testable.
2. **Choosing the strategy is a semantic call, not a style one.** `keepNonOverlapping`
   HIDES the loser — correct only where the reader can recover the value elsewhere (an
   axis tick is still readable off the scale). `dodgeLabels` NUDGES in y and keeps all —
   correct where the label is the only place a fact appears. Ask "if this label vanished,
   could the reader still get the number?" A hover readout does not count: it is not
   there at rest.
3. **Never resolve a collision by shrinking type.** The chart sizes in
   `ChainSchedule.tsx` (`FS_ROW`/`FS_EMPH` 12, `FS_AXIS` 11, `FS_SMALL` 10) were raised
   once for legibility (#83); a de-collider that undoes that is a regression in disguise.
4. Hand-rolled push-apart loops are the recurring trap. `CapacityChart` had one that
   only pushed *upward* and had no bounds, so a stack of thin top bands walked its
   labels clean off the plot — a de-collision pass that produced a *different*
   invisible-label bug. `dodgeLabels` clamps to a `YBounds` you must pass.
5. Drive the test from a fixture chosen to crowd, and prove the detector can see a
   collision before trusting it to say there is none.

**Still open.** `src/lib/hillLayout.ts` carries a second, independent de-collider (a
1D band/slot search with obstacles) and `ChainSchedule.tsx` a private copy of
`estimateTextWidth`. Neither is wrong; both mean "the de-collider" is not yet one
thing, so check which one a chart already uses before adding a third.
