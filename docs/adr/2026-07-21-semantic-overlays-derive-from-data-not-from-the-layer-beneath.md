---
status: accepted
date: 2026-07-21
supersedes: ""
superseded-by: ""
tags: [ui, rail, svg, motion, verification]
---

# A semantic overlay derives from the data it means, never from the layer beneath

**Context.** The rail's drift animation (dashes moving along track to show where
work is live and which way it runs) shipped wrong three times in a row, and all
three had the same shape: the overlay inherited a property from the layer it sits
on instead of deriving it from the thing it encodes.

1. **Direction from geometry.** Ties are authored by drawing convention — out from
   the rail at the top of a branch, back in at the bottom. That happens to match
   the work everywhere except the middle stops of a fan-**out**, where the path is
   drawn rail→lane but the work arrives lane→rail. Selecting a hub pointed five of
   its seven dependents *back at the hub they came from*.
2. **Quantifier from the ink.** The drift reused the ink's rule, which is universal
   ("done" needs *every* rider finished). But "carrying live work" is true the
   moment *one* rider is live. Requiring all of them stopped the drift at the first
   shared stretch — on a converging plan, immediately — leaving a stub two pixels
   long.
3. **Contrast from a constant.** The drift drew in `INK`, correct over the pale
   `--border` of an unfinished line and invisible over a finished one, which is
   already `INK`. A traced route is mostly finished edges, so the feature rendered
   as nothing.

Each bug produced **valid, correct-looking DOM**. A scripted audit counted 15
overlay elements with the right geometry and the right classes and passed; the
failure was only visible in a screenshot.

**Decision.** An overlay that carries meaning derives *every* property that carries
that meaning — direction, extent, colour — from the model, not from the path,
constant, or predicate it happens to sit on. Concretely on the rail: direction
compares edge endpoints against the tie's own phase and reverses the dash offset
(never the geometry, so one path definition still feeds ink, band and drift); the
"live" predicate is written existentially and separately from the ink's universal
one, with the difference commented; and the dash colour is chosen against whatever
the line under it resolves to. Where two encodings describe one thing — the
direction band and the drift — both derive from a **single shared filter**, so
colour and motion cannot come to name different track.

Verification: a semantic overlay is signed off from a **screenshot**, in both
themes. Counting elements proves existence, not visibility.

**Alternatives rejected.**
- *Reverse the path geometry for against-flow ties* — would fork the path
  definition three ways (ink, band, drift) to fix one of them.
- *One drift predicate shared with the ink* — the thing that caused bug 2; "done"
  and "moving" are different kinds of claim over the same set.
- *A fixed high-contrast drift colour* — no single value clears both a pale
  unfinished line and a dark finished one in both themes.
- *Trusting the DOM audit* — it approved all three bugs.

**Consequences.** Overlay code is wordier than the layer beneath it and repeats
derivations that look duplicative; that repetition is the decision, and collapsing
it reintroduces these bugs. Reviewing this class of change requires actually
looking at it, which no test in this repo replaces.

**Receipts.** `9109ce4` (drift introduced), `84de29d` (quantifier), `d666b49`
(direction + contrast, with a geometry-matched e2e guard pairing band to drift),
PR #17. See also
[A trace paints direct neighbours](2026-07-21-a-trace-paints-direct-neighbours-not-the-closure.md).
