---
title: A lazy regex over a JSX opening tag stops at the first arrow function, so the guard silently checks almost nothing
status: current
updated: 2026-07-24
applies_to:
  - writing a source-scan ratchet in tests/ that reads JSX props
  - tests/dataTableCallSites.test.ts
  - tests/headings.test.ts
symptoms:
  - a new source-scan test passes immediately and keeps passing when you plant a violation
  - a guard over component props never fires
verified_by: 'tests/dataTableCallSites.test.ts (mutation-checked by planting the forbidden prop as the LAST prop of a call site); #125'
---

# A lazy regex over a JSX opening tag stops at the first arrow function

**The lesson.** `/<Component\b[\s\S]*?>/` looks like "the opening tag", and it is
not. The lazy match ends at the **first `>` character**, and in real JSX that is
usually the arrow of a prop callback — `filterValue: (row) => …` — long before
the props you are checking. The guard then inspects a fragment, finds nothing,
and passes forever. Track `{}` depth and end the tag at a `>` seen at depth 0.

**Why it bites.** Every failure mode points the same way: green. The scan finds
matches, so a "did we match anything at all?" assertion still passes; it just
matches the wrong extent. Planting a violation to check the guard works only
proves it if the violation lands in the part of the tag the regex actually
reached — plant it as the *first* prop and the guard fires, plant it later and it
does not. That makes a half-broken guard look mutation-tested.

**What to do.** For anything reading component props, walk the source and track `{}`
depth, ending the tag at a `>` seen at depth 0 — `tests/dataTableCallSites.test.ts`
is the reference implementation.

Then **mutation-check by planting the violation in the LAST prop position**, not
the first — that is the case the naive regex misses, so it is the only plant that
distinguishes a working guard from a truncated one.

**How we found out.** #125's guard — "a `DataTable` declared `paginate={false}`
must not also take a free-text filter" — passed on the day it was written and
went on passing after the forbidden combination was planted in `PeopleClient`.
The regex had stopped at the arrow in a `filterValue` callback, about 300
characters into a tag whose `onTextFilterChange` sat far below.

Related: the same failure shape from the other direction — a test that agrees
with the code because both hard-code the answer — is in
[a test sharing the code's hard-coded answer](a-test-sharing-the-codes-hard-coded-answer-passes.md).
