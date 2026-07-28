---
status: accepted
date: 2026-07-28
supersedes: ""
superseded-by: ""
extends: ""
extended-by: ""
tags: [charts, ui]
---

# A value past a derived frame gets an off-scale marker pinned to the frame's edge, not a silent drop

**Context.** The Critical Chain buffer flow's frame is derived from the data
(`lib/bufferFlow.ts`'s `flowScale`), never fixed, so it can legitimately stretch
above 100% or below 0%. The 50%-of-remaining-work reserve marker
(`guidelineDays`) is a SEPARATE value with no such stretch: it is
`remainingTotal / 2`, and on any program with more remaining work than its
starting buffer (B₀) — the common case, not the rare one — it lands well above
100% of B₀. Before this decision (autoknow-4dr.2), the chart simply omitted the
marker whenever it fell outside the frame: on the seeded demo, B₀=62d against a
reserve of ~150d drew no marker at all, silently, on the majority of real
programs.

**Decision.** When a marker's true value falls outside the derived frame, draw
it PINNED TO THE FRAME'S OWN EDGE (the edge it would cross) with copy that says
so explicitly — `"{d}d reserve — above frame"` — rather than clamping it to a
value that looks like a real reading, or omitting it. The glyph is a dashed stub
poking past the edge, echoing the frame-crossing visual language already used
for a blown buffer's below-zero band.

**Alternatives rejected.**
- *Leave it dropped* (the prior behavior) — relies entirely on the headline's
  hover tooltip to state the reserve in words; the chart is the surface a
  reader actually scans, and a fact absent from it reads as "no reserve
  guidance for this program," not "ask the tooltip."
- *Stretch the frame to hold it* — the frame is shared with the buffer-left/
  buffer-spent bands, which are the reading the chart exists for; stretching it
  to fit an outlier reserve squashes that reading for every program where the
  two values diverge, which is most of them.
- *Rebase the reserve against remaining work instead of B₀* — bounded (0–100%)
  by construction, so it would always fit the existing frame. Rejected because
  it changes what the marker MEANS, not just how it draws: the reserve is a
  claim about the program's ORIGINAL buffer, and a value expressed against a
  constantly-shrinking "remaining work" denominator answers a different
  question every day, not the one the 50%-rule is stated in.

**Consequences.** Any future marker whose true position can exceed a data-
derived frame (this chart or another) should reach for the same pattern —
pin to the crossed edge, state the excess in words — rather than re-deriving
the choice. This does NOT apply to values the frame's own `flowScale` already
stretches to hold (the buffer-left/spent bands themselves): those are IN the
frame by construction, so there is nothing to mark off-scale.

**Receipts.** `src/components/ChainSchedule.tsx` (`guidelineAboveFrame`,
`offScaleLabel`), `src/lib/i18n.ts` (`clBufferGuidelineOff`),
`tests/labelCollisionSweep.test.tsx` ("draws the reserve OFF the frame's top…"),
bead autoknow-4dr.2, decided with the user over the three options above.
