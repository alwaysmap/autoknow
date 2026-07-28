---
title: The as-of predicate is UTC-day granular in SQL too — three ADRs describe the divergence it used to have
status: current
updated: 2026-07-28
applies_to:
  - src/lib/profiles.ts
  - src/lib/people.ts
  - docs/adr/2026-07-26-a-dated-row-is-labelled-as-of-its-own-date.md
  - docs/adr/2026-07-26-a-move-is-an-insert-into-a-timeline.md
  - docs/adr/2026-07-27-a-roster-is-three-buckets-from-one-call.md
symptoms:
  - "an ADR says `asOfWhere` compares raw instants while `coversDay` compares UTC days"
  - "an ADR names autoknow-yid as unresolved, or 'to be fixed in one place'"
  - "a roster ADR lists bucketing with `coversDay` as a REJECTED alternative"
verified_by: 'autoknow-yid; tests/profilesAsOf.test.ts "the two as-of spellings agree on a boundary day"'
---

# The as-of predicate is UTC-day granular in SQL too

**The finding.** Three ADRs were written while `asOfWhere` (Prisma/SQL) compared raw
INSTANTS and `coversDay` (JS) compared UTC DAYS, and each records that divergence as
live. It is closed — `autoknow-yid`, 2026-07-28 — and ADRs are immutable, so a reader
arriving at any of the three will otherwise conclude a fixed bug is still open:

* `a-dated-row-is-labelled-as-of-its-own-date` — "that is `autoknow-yid`, to be fixed in
  one place rather than by a third spelling here."
* `a-move-is-an-insert-into-a-timeline` — "it does not reconcile `asOfWhere` comparing
  raw instants against `coversDay` comparing UTC days."
* `a-roster-is-three-buckets-from-one-call` — lists bucketing with `coversDay` among the
  **rejected** alternatives, for the reason that it would disagree with `asOfWhere`.
  That reason is gone, and `rosterBucketOf` now does exactly what that ADR rejected.
  The ADR's decision is unchanged; only its rejection of this one alternative expired.

**What is true now.** All four spellings ask about a CALENDAR DAY: `hasTakenEffect` and
`coversDay` in `lib/people`, `asOfWhere` and `personIsAtPartnerAsOfSql` in `lib/profiles`,
and `rosterBucketOf`, which is `hasTakenEffect` twice.

**The one thing worth carrying forward** — because the obvious implementation is the
wrong one. The SQL is day-granular by comparing against `startOfNextUtcDay(at)`, NOT by
truncating the column:

```
utcDay(start) <= utcDay(at)   ⟺   start <  startOfNextUtcDay(at)
utcDay(end)   >  utcDay(at)   ⟺   end   >= startOfNextUtcDay(at)
```

`date_trunc('day', "startDate") <= …` states the same rule and is **not sargable**, so it
would silently cost the composite index #127 E4 added and EXPLAIN-verified. Moving the
boundary into the parameter keeps the column bare on the left of every comparison, which
is what the index needs. If a future change makes this predicate day-granular "more
obviously", check the plan before believing it.

**Why the bug was invisible for so long.** Every date surface in this app writes UTC
midnight, and at midnight the two spellings agree. It takes a row from somewhere else — an
import, a backfill, a hand-authored fixture — for the disagreement to appear, and then it
appears as four different answers on one page rather than as an error.
