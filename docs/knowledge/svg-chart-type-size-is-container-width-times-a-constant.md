---
title: A viewBox-scaled SVG's type size is its container's width times a constant — authored "8" is not 8px anywhere
status: current
updated: 2026-07-25
applies_to:
  - src/components/PhaseHillChart.tsx
  - src/components/PhaseHillGauge.tsx
  - src/lib/hillLayout.ts
symptoms:
  - chart labels render far larger or smaller than the surrounding page type
  - the same chart component looks right in a sidebar and wrong at full width
  - a font-size in an SVG cannot be made to land on a whole pixel (design.md §8d rule 2)
verified_by: 'issue #154 screenshots — 1440px: labels 13.9px, coins 19.2px (were 24.4/33.5); 768px: labels 9.2px; tests/hillLayout.test.ts runs every layout assertion at two ink factors'
---

An `<svg viewBox="0 0 W H" style="width:100%">` maps every authored number through
`renderedWidth / W`. Authored sizes are therefore **ratios, not measurements**, and
the same component in two containers is two different type scales.

The concrete instance: `PhaseHillChart` is authored in the per-phase gauge's 200-unit
space, where `--status-viz-w` (16.25rem) makes a unit ≈ 1.3px. Its `wide` variant put
420 units across the 80rem content column — 1280px at the 1440px design target — so a
unit became ≈ 3.05px. Nothing in the component changed, yet `fontSize={8}` rendered at
**24px** (larger than the section's own `h2`) and `DOT_R = 5.5` produced **33px**
coins. The `wide` prop looked like a layout switch; it was a 2.3× magnifier.

Three consequences worth knowing before touching any chart here:

1. **You cannot satisfy §8d rule 2 (whole-pixel font sizes) at more than one viewport
   width.** The size is a product of a fluid width, so it is integral at one width and
   fractional everywhere else. Size for the design target (§9: 1440px) and say so.
2. **The ratio between two compliance widths is fixed and no constant can flatten it.**
   The content column is 1280px at 1440 and 688px at 768 — 1.86:1 — so shrinking the
   authored type to fix the desktop end shrinks the tablet end by the same factor.
   Choose the factor from the NARROW end (the 9px floor in the type scale, §8d rule 3)
   and cap the wide end separately, with an author-set rem `max-height` (§9b) that
   stops the scale growing past the design target. A `max-height` costs nothing at the
   widths below it — the drawing still fills the column — whereas a fixed `height`
   letterboxes a viewBox drawing on a phone.
3. **Split the authored numbers by what they are measured against.** Type, coins and
   touch targets answer to the reader's eye and finger and want a fixed rendered size;
   the curve, the groove and the positions are the drawing and should scale. Strokes
   that are hairlines take `vector-effect="non-scaling-stroke"` and stay 1px at any
   scale — it does **not** apply to text or to `r`, so those need real constants.
   Deriving every dot-shaped measure from one `dotRadius` and every label-shaped one
   from one `fontSize` is what lets one number restate the whole drawing at another
   size instead of producing a differently-proportioned second drawing.
