---
title: A fixture whose point is "this is scheduled" must DERIVE the date from seed time — a literal expires and the fixture starts lying
status: current
updated: 2026-07-26
applies_to:
  - src/lib/seed.ts
  - tests/helpers/fixtures.ts
symptoms:
  - a seeded "scheduled" / "upcoming" / "future-dated" case demonstrates nothing any more
  - the demo that used to show a future-dated defect now looks correct
  - two documents disagree about a fixture's date and neither is obviously stale
verified_by: 'tests/seedMock.test.ts "Alice Waters carries four contiguous periods, with Honda still in the future"; spec #124 §7 vs. its own Class 1 repro'
---

# A fixture whose point is "this is scheduled" must DERIVE the date from seed time

**The lesson.** When seeded data exists to exercise a *future* case — a scheduled
move, an incoming hire, an SOP not yet reached — the date must be computed from
seed time (`new Date(Date.UTC(y, m + 4, 1))`, `aheadMonthEnd(n)`), never typed as
a literal. A literal is only in the future for a while, and nothing announces the
day it stops being one.

**Why it bites.** The failure is silent and it inverts the fixture's meaning
rather than breaking it. A row seeded to prove "before this date the app shows
the OLD company" becomes a row where the date has passed, so the app is right to
show the new one — the demo looks correct, and any test pinned to it now passes
on a degenerate case. Past dates are the opposite: a career, an incident, a
shipped program are FACTS, and deriving those from `now` would make history
drift. So the two halves of one fixture are dated by different rules, and the
rule follows the claim: settled facts get literals, "not yet" gets arithmetic.

**What to do.** Derive the date, and assert it by its PROPERTIES — genuinely
ahead by months, on a month boundary — not by re-deriving the literal in the
test, which is
[a test sharing the code's answer](a-test-sharing-the-codes-hard-coded-answer-passes.md).
Say in the comment what the derivation yields on the day you wrote it, so a
reader can reconcile it with a spec that quotes a fixed month.

**How we found out.** Spec #124 disagreed with itself: §7's persona table
scheduled Alice Waters' Honda move for 2026-11, while the Class 1 repro in the
same issue showed 2026-09-01. Neither was wrong when written — the repro was a
screenshot of the live demo, whose literal had simply aged toward the present.
The fixture (#127 E1) derives instead: first of the month, four months out.
