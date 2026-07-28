---
title: Converging call sites onto a shared predicate misses the surface that asks the same question with a ruler
status: current
updated: 2026-07-27
applies_to:
  - src/lib/chainDay.ts
  - src/lib/bufferSeries.ts
  - src/components/ChainSchedule.tsx
  - extracting a predicate and sweeping for its copies
  - drawing a band, span or sub-bar from a ScheduleRow's start/end/plan timestamps
symptoms:
  - a bar draws red beside a row card that says the phase is on plan
  - the day strip names a phase over its estimate but the waterfall has no row for it
  - a grep for the field the predicate tests finds every copy and the bug is still there
verified_by: 'src/lib/chainDay.ts phaseDaySpans `done` branch, now gated on `isRealizedOverrun`; tests/chainDay.test.ts "a done phase past its plan tick by less than a day (autoknow-4dr.3)"; tests/chainLedger.test.ts "the five waterfall predicates > keeps the realized/forecast threshold asymmetry"; eslint chainPredicates family; autoknow-4dr.1 (935-case equivalence run), fixed in autoknow-4dr.3'
---

# Converging call sites onto a shared predicate misses the surface that asks the same question with a ruler

**The lesson.** When you extract a duplicated predicate, grepping the FIELD it
tests finds every copy that spells the question the same way — and none of the
ones that reach the same conclusion by measuring geometry instead. Those sites
never mention the field, so neither grep nor a `no-restricted-syntax` rule
anchored on it can see them. Sweep a second time by asking *which surfaces decide
this same fact*, not *which files name this variable*. (Sibling failure, same
symptom, different cause: [a Prisma back-relation has its own
name](a-prisma-back-relation-hides-the-field-you-are-grepping-for.md).)

**Why it bites.** The two instruments work at different resolutions, and that is
invisible until data lands between them. `chainLedger`'s predicates test
`varianceDays`, **rounded to whole days** — the unit the whole buffer system
accounts in. `chainDay.phaseDaySpans` emits its `over` span from
`push(state, plannedEndMs, endMs)`, which fires on **any positive millisecond
difference**. A phase finishing 9.6h past its plan tick has `varianceDays === 0`:
no waterfall row, no `sunkOverrun` packet, no red grid cell, and a row card
reading "on plan" — while the day strip paints that day `over`. Both sides look
right in isolation, and the one disagreeing with the other four is the one with
no threshold in it at all. AGENTS lesson 18 arriving from underneath: the ink
derived from the geometry beneath the bar, not from the fact it means.

**What to do.** After the grep-driven sweep, list the surfaces that RENDER this
fact and open each one; a site is a copy if it decides the same thing, however it
spells it. Two tells that a site is measuring rather than asking: it compares
**timestamps or coordinates** where the predicate compares a **count** (the count
is the rounded one, and rounding is the whole disagreement), or it emits on a
**width** (`if (toMs > fromMs)`, `if (w > 0)`) rather than a named condition —
that guard reads as "don't draw an empty box", which is why nobody reviews it as
a predicate. Then route it through the shared predicate, or write down why this
surface is deliberately finer-grained. Do not assume a lint rule covers it: the
`chainPredicates` family blocks comparisons against `varianceDays` /
`gapBeforeDays` and cannot block `endMs` against `plannedEndMs`, legitimate
geometry everywhere else in the same file.

**How we found out.** `autoknow-4dr.1` converged 20 hand-rolled comparisons of
the five waterfall predicates across five files, proving every one semantically
identical over a 935-case grid before deleting it — a clean refactor by every
check it ran. The one real divergence sat in the file the bead already named, in
the function next door to the one being fixed, and neither field is compared
anywhere in it (`autoknow-4dr.3`).
