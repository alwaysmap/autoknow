---
title: A week-floored chart axis can start several days before its first real phase — a tap/click near the axis edge can land on empty space
status: current
updated: 2026-07-28
applies_to:
  - src/components/ChainSchedule.tsx
  - tests/chain_touch.spec.ts
  - e2e tests that tap/click an SVG chart and assert on what a specific x position shows
symptoms:
  - a Playwright tap at a fixed offset (e.g. "2px from the row's left edge") shows an empty/placeholder state instead of the expected data
  - a chart test passes with synthetic (unit-test) dates but fails against real wall-clock dates in e2e
  - "Nothing in flight" / an empty-state string appears where a specific phase name was expected
verified_by: 'tests/chain_touch.spec.ts "tapping the body updates the day strip…" (the multi-fraction retry); autoknow-4cd'
---

# A week-floored chart axis can start several days before its first real phase

**The lesson.** `ChainSchedule.tsx`'s x-axis domain is `weekFloor(firstStartMs)`
— the Monday of the week the earliest phase starts in — not the phase's own
start day. A tap or click positioned at "the very left edge of the plot" can
therefore land on a day that is genuinely before any phase begins, even though
it is inside the row rect that phase renders in. This is invisible in
deterministic unit-test fixtures (`day(n)` helpers pin `now` and every phase
date to fixed offsets), and only shows up against REAL wall-clock dates in e2e,
where the gap between `weekFloor` and the true start date varies run to run.

**Why it bites.** A row's hit rect (`rowHit`) spans the row's full width, but
what the day-driven UI it fires (the docked day strip, `lib/chainDay.ts`'s
`summaryAt`) shows depends on the TAPPED X POSITION's date, not on which row's
rect received the gesture. Assuming "tap this row → see this row's data" — true
of the retired per-row hover card, false of the day strip that replaced it
(issue #161 step 4/4) — produces a test that is fragile against exactly the
axis rounding described above.

**What to do.** Don't assume a fixed pixel offset lands inside a specific
phase's span. Either (a) try several x fractions across the row's width until
one lands on real data (see `tests/chain_touch.spec.ts`'s `fractions` array),
or (b) drive the interaction through a mechanism that reads the ROW directly
rather than a screen position — keyboard focus does this (`onFocus` reports
`dayFloor(r.startMs)`), which is why `project_details.spec.ts`'s keyboard test
can assert a specific phase name reliably while the touch test cannot.

**How we found out.** `tests/chain_touch.spec.ts`'s touch-split test tapped at
`x: 2` (the row rect's own left edge) expecting the earliest phase's name;
against the real seed data it landed one day before that phase's start,
inside the axis's week-floored lead-in, and asserted `"Nothing in flight"`
instead.
