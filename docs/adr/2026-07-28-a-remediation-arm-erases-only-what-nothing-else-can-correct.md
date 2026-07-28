---
status: accepted
date: 2026-07-28
supersedes: ""
superseded-by: ""
extends: "a-remediation-arm-is-bounded-and-picks-by-rule"
extended-by: ""
tags: [database, backfill, data-integrity, people]
---

# A remediation arm erases only what nothing else can correct, and reports what its rule cannot decide

**Context.** `conflicting-addresses` (bead `autoknow-164`) is the second `db:remediate:*`
arm, and the first whose write DESTROYS a recorded fact: it sets a `PersonAffiliation`
period's `email` to NULL on one side of a conflict `db:check:email-conflicts` found. The
first arm only ever filled a NULL. Two questions the bounded-and-picks-by-rule ADR does
not answer fell out immediately. Some losing periods cover TODAY, where #127 E14's editor
can already write the address the person actually uses — better than NULL, by a human who
knows. And its rule ("whoever holds the address now wins") decides nothing at all when
nobody, or two people, record the address as theirs — which is not the bound being
exceeded, so clause 1's refusal does not obviously apply.

**Decision.** Two more things are required of an arm in this namespace.

1. **It writes only where nothing else can.** Where an in-app path exists for a row, the
   arm names that path and leaves the row alone — reported as DEFERRED, not as a failure.
   The app records what is TRUE; an arm can only erase what is false, and erasing where
   somebody could have corrected is the worse trade. Here the test is `coversDay`, because
   `correctPersonRecord` writes `asOfWhere(today)` and no other period.
2. **A row its rule cannot decide is REPORTED and LEFT, never refused and never guessed.**
   Leaving it IS the not-guessing (clause 2), and it must not fail the run: a refusal would
   convert "this one needs a human" into "and so do the four this run could have fixed",
   with no way for the operator to unblock it. The refusal stays reserved for the BOUND,
   which is a statement about the scale that was reviewed, not about any one row.

Consequently, exit 0 no longer means "everything is fixed" — so a report carrying DEFERRED
or UNDECIDABLE rows says in its own last lines that the `db:check:*` arm gating it will
still find them.

**Alternatives rejected.**

- *Refuse the whole run on an undecidable row.* Symmetrical with the bound, and a dead
  end: nothing in this repository can decide who held an address in 2022, so the operator
  has no move that clears the refusal.
- *Clear the losing period even when it covers today.* One code path instead of two, and it
  spends a correctable fact to save a branch — it would write NULL over a period the
  person could have been asked about that afternoon.
- *Let the arm write the address it thinks the loser should have had.* There is no such
  address to read: what a wrongly-recorded 2022 period should have carried is not
  recoverable by any query. NULL — "not recorded" — is the only honest value.
- *Skip the arm entirely, since #127 E14 shipped a unified editor.* E14 made TODAY's record
  correctable and history readable; it did not make a closed period editable. Verified
  against `correctPersonRecord`, and pinned by `tests/uniqueAtAnInstant.test.ts` ("leaves
  history alone — only the period covering today is corrected").

**Consequences.** A remediation report now has three outcomes per row rather than two, and
the runner's `db:remediate:*` epilogue had to stop being worded for `unmatched-owners`
specifically — it says "the rows the report lists as written" and points at the declined
ones. An arm's success is therefore no longer readable from its exit code alone, which is
a real cost, paid because the alternative is an arm that either lies about being finished
or refuses to start.

**Receipts.** Bead `autoknow-164`, extending ADR
`a-remediation-arm-is-bounded-and-picks-by-rule`. Rehearsed end to end against a local
scratch database seeded to a pre-E9 shape (5 periods, 3 conflicting pairs, 2 addresses):
`email-conflicts` reported 3 pairs, the arm cleared 1 period and left an address nobody
holds today UNDECIDABLE, an immediate re-run cleared nothing, giving that address a current
holder made the second one decidable, and `email-conflicts` then reported `No conflicts`
and the exclusion constraint applied to that database. `tests/addressConflictRemediation.test.ts`
pins the rule, the deferral, both undecidable shapes, the three-person case and the bound.
NOT proven, as with the runner itself: the proxy hop, the Secret Manager read and the WIF
grant.
