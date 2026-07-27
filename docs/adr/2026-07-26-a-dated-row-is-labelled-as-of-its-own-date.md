---
status: accepted
date: 2026-07-26
supersedes: ""
superseded-by: ""
extends: currentpartnerid-is-a-cache-affiliations-are-the-truth
extended-by: ""
tags: [identity, affiliations, feed, activity]
---

# A dated row is labelled as of ITS OWN date; a list of dated rows resolves per row

**Context.** The as-of ADR this extends settled *how* to ask which company a person is at
— `lib/profiles` in SQL, `coversDay` in JS, no third spelling. It did not settle *which
day to pass*, and every caller so far passed today, because every caller so far rendered
today. `/people/:id`'s Activity History (#127 E10, spec #124 §7) is the first surface
whose rows are dated across a career: Alice Waters' feed spans Bosch 2022 → Qualcomm 2025
→ Google now. Labelling that list once, with the job she holds today, is #124 Class 2 —
a 2022 update filed under an employer she joined four years later. The actor column
cannot rescue it: `source` holds `getCurrentUser().handle`, which is deliberately stable
across a move and therefore says nothing about when.

**Decision.** **A surface passes the date of the thing it is rendering, not the date it
is rendered on.** Identity lines, directories and counts are about today and pass today.
Anything carrying its own timestamp — a feed item, a briefing, a per-record roll-up, a
programme involvement — resolves as of that timestamp, per row.

Two corollaries, both load-bearing:

* **A list resolves from ONE fetched career, compared with `coversDay`.** Twenty-five
  rows must not be twenty-five `profileAsOf` calls. This is the division the `lib/profiles`
  header already draws, applied to the many-instants case: SQL when the rows are still in
  the database, `coversDay` when you already hold them.
* **A scope may narrow by ACTOR rather than by subject, and it extends the existing
  scope.** `FeedScope` gained `{ kind: 'person' }` inside `getActivity`; there is no
  second feed path (AGENTS lesson 7).

**Alternatives rejected.**

* *Label the whole list with the person's current company.* The defect, restated as a
  feature.
* *Ask `profileAsOf` per item.* Correct and 25 round trips per page load; the batched
  resolvers are keyed by PERSON, not by instant, so they do not help here.
* *Read the company off the actor string.* `source` is a handle, stable by design across
  every move — the one column guaranteed not to carry the answer.
* *A separate person-feed module.* A near-duplicate re-opens the bugs the shared feed
  already killed, and would have had to re-derive the actor filter and the ordering.

**Consequences.** A row whose timestamp falls in a career GAP, or before the first
period, is labelled with no company at all — null stays a real answer, per the spec's gap
rule. The two sanctioned spellings compare at different granularities (`asOfWhere` on raw
instants, `coversDay` on UTC days), so `/people/:id` is now the first page to render both
and can disagree on a boundary date; that is `autoknow-yid`, to be fixed in one place
rather than by a third spelling here.

**Receipts.** PR for `autoknow-mi4` (#127 E10); `tests/personActivityScope.test.ts`
"attributes each item AS OF ITS OWN DAY, not as of today"; `tests/people.spec.ts` "the
activity feed labels each entry with the company held THEN, not today".
