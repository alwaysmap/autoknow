---
status: accepted
date: 2026-07-22
supersedes: ""
superseded-by: ""
tags: [ui, layout, css, box-model, charts]
---

# Containers own outer spacing; charts fill width and own their height

**Context.** Nothing was written down about who owns the space between a component
and its surroundings, or about how a chart decides its size. A de facto convention
already existed — `gap` outnumbers outer margins on component roots roughly two to
one (193 `gap` uses against ~100 `margin-top`/`margin-bottom`) — but because it was
unstated, component roots drifted into setting their own outer margins and
responsive layouts became unpredictable: the same component spaced differently
depending on where it was dropped. Charts had a parallel gap. design.md §8d had
explicitly *deferred* the one it named — "an SVG with `width: 100%; height: auto`
computes a fractional height at almost any width … left alone deliberately because
fixing it means choosing how gauges behave when they shrink, which is a design
decision, not a cleanup." This record makes both decisions and stops the drift.

**Decision.**

1. **The container owns the space between siblings.** A component's root element
   never sets an outer margin (`margin`/`margin-top`/`margin-bottom`); the parent
   supplies the separation with `gap` (or `padding`). A component with no outer
   margin drops into any layout unchanged — a flex column, a grid cell, a dialog —
   and is spaced by that layout, not by an assumption baked into the component
   about what sits above or below it. Centring (`margin: 0 auto`) and resets
   (`margin: 0`) are not outer spacing and are unaffected.

2. **A chart fills its container's inline size and owns its own height.** It knows
   nothing about its container's width — `width: 100%` — and does not measure it in
   JS to size itself. Height is **author-set in `rem`**, which also lands it on a
   whole pixel, resolving the fractional-height source §8d deferred. "How a gauge
   behaves when it shrinks" is answered: the width fills, the height is fixed by the
   author at each breakpoint if it must change, so the aspect ratio is a decision,
   never an emergent fraction.

**Alternatives rejected.**
- *Child-owned margins* (the status quo drift) — every component encodes an
  assumption about its neighbours, so the same component is mis-spaced the moment
  it moves, and two adjacent components' margins collapse or double unpredictably.
  `gap` on the parent has neither problem and is already the majority.
- *`aspect-ratio` height for charts* — ties height to width, so a wide, short chart
  becomes tall on a phone (or a tall chart becomes a sliver), and the height is a
  fraction of a fractional width — back to the §8d problem it was meant to fix.
- *JS container measurement (`getBoundingClientRect`) to size a chart* — a layout
  read on every resize, a reflow, and a flash of the wrong size before the effect
  runs. Charts that measure today do it for pointer math, popup placement, dialog
  geometry, and scroll anchoring — none of that is a chart sizing itself, and none
  of it changes.

**Consequences.** A component root that sets an outer margin now fails CI
(`tests/componentRootMargins.test.ts`) — a ratchet with an explicit allowlist that
may only shrink, chosen because "the component's root class" cannot be identified
statically from a CSS module reliably enough for a naive regex (it would miss real
violations or flag legitimate inner margins). The sweep behind the allowlist
re-derived the current violators rather than trusting the tracking issue's table,
and the table was both stale and incomplete: `PhaseGraph` and `PhaseTrack` no longer
set a root margin (the rail work — `e6c1502`, `d666b49` — already moved them to
`width: 100%`), while three the issue never listed do — `DataTable` (`.tableWrapper`,
the shared table used everywhere), `AnchorHeading` (`.row`, the shared heading), and
`SummaryToolbar` (`.bar`). The current root-margin set is therefore `BusiestResources`,
`ChainLedger`, `DataTable`, `AnchorHeading`, `SummaryToolbar`; each is allowlisted
with the rule now enforced around it, and each migration to parent `gap` is a real
layout change (shared components most of all) that lands as its own screenshot-verified
change and shrinks the allowlist. §8d no longer describes the gauge-height question as
open; it points here. Anything genuinely needing to know its rendered size still
measures — the rule is "a chart does not measure to *size itself*", not "no component
measures."

**Receipts.** Issue #36 (decisions taken 2026-07-22). Sweep command, re-runnable:
per component, the root element's `styles.*` class from the outermost tag of its
render, checked for a non-zero, non-`auto` outer margin —
`tests/componentRootMargins.test.ts` is that sweep, executable. Evidence counts
(`gap` 193 / `margin-bottom` 61 / `margin-top` 41) from `grep -rc` over
`src/components/*.module.css` at record time. §8d's deferred note predates this and
is updated in the same change (AGENTS lesson 10).
