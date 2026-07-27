---
status: accepted
date: 2026-07-27
supersedes: ""
superseded-by: ""
extends: ""
extended-by: ""
tags: [identity, affiliations, temporal, ui, tables]
---

# A partner's roster is three buckets from ONE call, and the buckets are the as-of predicate complemented

**Context.** #124 §4 asks a partner page for three things about the same instant: who works
here, who used to (with the date they left) and who is transferring in (with the date they
arrive). Only the first is expressible as a `where` clause — the other two are defined by
rows OUTSIDE the as-of window, so no single predicate returns them pre-split. The page also
prints an employee FIGURE, and #124 §7 opens with the defect of a number that disagrees with
the list under it. Meanwhile ADR
[`currentpartnerid-is-a-cache-affiliations-are-the-truth`](2026-07-26-currentpartnerid-is-a-cache-affiliations-are-the-truth.md)
sanctions exactly two ways to ask which company covers a day — `lib/profiles` in SQL,
`coversDay` in JS — and warns that a third date comparison is the bug.

**Decision.** `partnerRosterAsOf(partnerId, at)` returns `{ current, past, incoming }` — one
query for every affiliation the partner has ever held, split by `rosterBucketOf`, a total
function beside `asOfWhere` in the same module. The three arms ARE §4's interval table:
`start > at` is incoming, `end <= at` is past, and everything left is `start <= at AND (end
IS NULL OR end > at)` — `asOfWhere` complemented, not a second opinion about it. Every
people-shaped thing on a partner surface derives from that one call: the employee figure is
`current.length` and the table's default view is that same bucket, so the number and the
list are the same array.

**Alternatives rejected.**

- *Keep `partnerRosterAsOf` returning bucket (a) and add a second bucketing resolver.* Two
  roster functions, one a subset of the other, is AGENTS lesson 7's creation-side twin — and
  it re-opens the exact gap this closes, because the count and the table would then come
  from different calls and could only be kept equal by a test.
- *Three queries, one per bucket, so every predicate stays in SQL.* Honest, and it keeps the
  index bound on all three — but it spends three round trips to answer one question about
  one partner, and it puts the "exactly one bucket, never two" property beyond any single
  place to state or check. A partner's roster-over-time is bounded by its own headcount.
- *Return the raw affiliations and let the page bucket them.* That is the third comparison
  the cache ADR warns about, authored at a call site where nothing relates it to `asOfWhere`
  — and it would be authored again on the next surface that needs the same split.
- *Bucket with `coversDay` (the sanctioned JS spelling).* It compares UTC DAYS while
  `asOfWhere` compares raw instants (`autoknow-yid`), so the table and the count would answer
  differently for any period stored with a time of day — which the affiliations endpoint
  accepts. Matching `asOfWhere` keeps the divergence a single known bug with a single fix.

**Consequences.**

- A JS date comparison now lives in `lib/profiles`. That is inside the cache ADR's answer #1,
  not a fourth spelling — but it is still a second RENDERING of one sentence, and nothing
  static can compare two renderings. It is pinned the way `personIsAtPartnerAsOfSql` is: a
  test asserts the `current` bucket equals what `profileAsOf` resolves, on every day tried.
- A partner surface can now show a person who has LEFT, which no query in this app could
  express before. "Past" is a rendered state, not an absence.
- The roster query no longer bounds on a date, so it reads the `(partnerId, …)` index prefix
  rather than the full composite. Accepted: the alternative is three queries, and the row
  count is a partner's headcount over time.
- A person with two stints at one partner is two rows, in two buckets. That is the truth;
  a de-duplicating roster would have to pick one and would pick the wrong one for someone
  who is both a former and an incoming employee.

**Receipts.** #127 E12. `tests/profilesAsOf.test.ts` — "splits one partner three ways on a
single day", "turns over on the boundary day itself, at both ends", "puts every affiliation
in exactly one bucket, and loses none", and "agrees with profileAsOf about who is at the
partner, on every day tried". `tests/partner_people.spec.ts` drives the rendered table.
