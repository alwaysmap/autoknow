---
title: A de-collider says "clear" at a zero-pixel gap, so a row chart's own pitch produces label pairs that pass every test and read as one clump
status: current
updated: 2026-07-28
applies_to:
  - src/lib/labelPlacement.ts
  - src/components/ChainSchedule.tsx
  - any chart placing one label per row plus another in the channel between rows
  - a row chart whose row height is a small multiple of its type size
symptoms:
  - two numbers about two different rows read as one stacked pair, but no overlap test fails
  - a label pair that looks wrong on screen and measures under a pixel of clearance
  - moving a label "a few px" has nowhere to go — the channel is narrower than the label
verified_by: 'tests/labelCollisionSweep.test.tsx §5 "separates an idle count from the variance number above it in X, not by a hair in Y" — restoring the pre-fix y makes it report `"6d idle" crowds "−7d" (Δy 12.8)`; images from `npm run test:e2e:screens`, "Critical Chain screenshots" in tests/phase_screenshots.spec.ts (screenshots/ is gitignored, so re-run the spec rather than looking for the files); issue #161 step 3/4'
---

# A de-collider says "clear" at a zero-pixel gap

`overlaps()` in `labelPlacement` is a strict intersection test, and `halfHFor` reserves
`fontSize / 2 + 1`. Two labels `2 × halfH` apart therefore report clear with **zero**
pixels between their boxes, and anything a hair beyond that is equally a pass — legible
only in the sense that no glyph touches another. In a chart with one label per row, a
separation in that neighbourhood is not a coincidence you can wave away: it is the row
pitch minus the channel offset, so it recurs on every row of every dataset, and no
placement pass, no `collidingPairs` assertion and no amount of fixture crowding will ever
flag it.

**Why it bites.** The passes are the only mechanical check anyone runs, so "the sweep is
green" gets read as "the labels are fine". `ChainSchedule`'s Option A rows put a phase's
variance number on the row centre and the next row's idle count in the channel above that
row: the count sat `ROW_H / 2 + 1 + CAP_HALF_EM × FS_SMALL` below its OWN row's centre,
so the separation from the row above was `ROW_H` minus that — 12.8px for `ROW_H` 34 and
`FS_SMALL` 10, against the 12.0px the two boxes reserve. **0.8px of clearance**, which is
a pass. And the crowding is not rare: a gap usually opens *because* the previous phase
over-ran, so the two labels that clump are the two the data pairs up.

**What to do.**

1. **Do not reach for a nudge first.** A y-dodge cannot help when the channel is thinner
   than a label box — in a row chart, `ROW_H / 2 − BAR_H / 2` is typically under
   `2 × halfHFor(size)` — and a nudge big enough to clear moves the label onto a
   neighbouring row, which is worse than tight: it re-attributes the number.
2. **Move the label to a line the geometry gives room on.** Here the idle count moved from
   *above* its dashed rule to *on* it, haloed so it knocks the dashes out. 6.2px on a 34px
   row — separation 12.8 → 19 against 12 reserved, so clearance 0.8 → 7 — and it cost
   nothing, because a knocked-out annotated rule is a conventional reading.
3. **Keep the mark visible when the label lands on it.** A label centred on a short rule
   knocks the whole rule out and deletes the mark (AGENTS lesson 18). Centre only when the
   rule is comfortably longer than the label; otherwise step outside it.
4. **Sign off from a SCREENSHOT, cropped and upscaled.** At 1× a 0.8px gap and a 7px gap
   look the same. `sips --cropToHeightWidth … --cropOffset …` then `--resampleWidth` is
   enough; the defect was invisible in the full-page image and obvious at 3×.

**How we found out.** #161 step 3/4's label sweep was green, the chart-level fixtures were
chosen to crowd, and the first full-size screenshot looked fine. The crop showed `+7d`
(Bring-up's overrun) and `8d idle` (the gap before Integration) stacked as one block of
two numbers about two different phases — in a chart whose entire premise is that every
mark has an owner.
