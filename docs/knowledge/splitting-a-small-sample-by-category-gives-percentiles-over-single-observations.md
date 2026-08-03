---
title: Splitting a small sample by a category gives you percentiles over single observations
status: current
updated: 2026-08-03
applies_to:
  - src/lib/dashboardData.ts
  - any chart or metric computing percentiles per category (phase name, partner, product)
  - the unbuilt ConstraintView (docs/COMPONENT_PLAN.md §2.8)
symptoms:
  - a P50 and a P85 that are the same number, on row after row
  - every category has one or two items in it
  - a chart whose height grows with a vocabulary rather than with the data
  - two rows that are obviously the same thing spelled differently
verified_by: 'autoknow-7ii — 67 phase spans over 44 distinct phase names, 1.5 items per bucket; the rework to one population is the PR that carries this note'
---

# Splitting a small sample by a category gives you percentiles over single observations

**The lesson.** Percentiles need a population. Before grouping a metric by a categorical
key, divide: items ÷ distinct keys. AutoKnow's cycle-time chart grouped 67 phase spans by
phase NAME across 44 names — 1.5 items per bucket — and drew a "P50" and a "P85" for each.
Most of those were one observation with two labels on it. The chart looked like statistics
and was arithmetic on singletons.

**Why it bites.** Every individual number is defensible: `percentile([x], 0.5)` is `x`, and
the code that computes it is correct. Nothing throws, no test fails, and the output is
shaped exactly like a real distribution — same axes, same reference lines, same confident
captions. The failure is only visible in the ratio, which no single row shows you. It also
hides a second defect: with buckets that thin, a key that splits — ours split four phases
on capitalisation alone, `Architecture Lock` vs `Architecture lock` — halves an already
meaningless sample without changing anything a reader could notice.

**What to do.** Ask what population the reader is being asked to compare against, and check
it can support the claim.

- If the answer is "all of it", do not group at all. One population, and the category
  becomes a hover detail rather than an axis. This is what flowmetrics does for cycle time,
  and it is what the rework did here: 44 rows and ~3800px collapsed to one 380px chart.
- If per-category really is the question, gate on sample size per bucket and say what the
  sample was. `CycleTimeStats.sampleSize` rides inside the stats object for that reason, so
  percentiles cannot be rendered without the number that qualifies them, and below
  `MIN_SAMPLE` the reference lines are not drawn at all — the chart says why instead.
- Normalise the grouping key before trusting bucket counts, or case and whitespace will
  quietly fragment it further.

**How we found out.** The chart had been computed on every dashboard render and mounted
nowhere, so nobody had ever looked at it. Mounting it made the shape obvious in one
screenshot — row after row of identical P50/P85 pairs — which is the same lesson AGENTS 18
teaches about overlays: counting elements proves existence, not sense. `docs/COMPONENT_PLAN`
§2.8 still specified "cycle time per phase-name … percentiles" for the unbuilt
`ConstraintView`; that line was corrected in the same change, because a spec is where this
mistake would have been made a second time.
