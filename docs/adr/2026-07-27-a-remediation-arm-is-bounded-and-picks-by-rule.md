---
status: accepted
date: 2026-07-27
supersedes: ""
superseded-by: ""
extends: "a-backfill-reaches-prod-through-an-allowlisted-dispatch-runner"
extended-by: ""
tags: [ci, database, security, backfill, data-integrity]
---

# A one-shot production data fix is an arm with a row BOUND and a rule, never a statement someone types

**Context.** #127 E6's backfill ran against prod (workflow run 30230033333) and reported
`linked: 9 / unmatched: 2 / ambiguous: 0`. The two leftovers are mock display names from
the initial seed (`4ded811`) — `Alice PM` and `Clara Operations` — that named no Person in
that database, so re-running the backfill can never clear them and #127 E7 stays gated.
`docs/OPERATIONS.md` already conceded the shape of the gap for a sibling case: *"this
needs a hand-written statement run by someone with database access"*. That is the option
the dispatch-runner ADR exists to refuse, and it had quietly come back for the class of
problem a backfill deliberately declines to solve.

**Decision.** A one-shot correction of production DATA ships as an allowlisted arm on the
same runner, in a third namespace, `db:remediate:*`, and it must:

1. **Bound its blast radius and refuse above it, before the first write.** `unmatched-owners`
   stops at 2 because prod's E6 report named exactly two rows; a third is by definition
   something no reviewer saw. A remediation that silently rewrote fifty rows because an
   assumption changed under it is indistinguishable, in the report, from one that worked.
2. **Choose by a rule evaluated against the database, never a hardcoded id.** Here: the
   person owning the most programs, ties and an all-zero field breaking to the lowest
   `Person.id`. Nothing on this path can query prod to check that an id it was born
   holding still names the person somebody meant, so an id in the diff is a claim the
   reviewer cannot check and the run cannot verify — whereas a rule is re-evaluated
   against whatever prod actually contains and printed with the count it won on.
3. **Mean something different by its exit code, and say so in the same words everywhere.**
   A backfill's leftovers are a report (exit 0); a check exits non-zero because it FOUND
   something; a remediation exits non-zero because it REFUSED and wrote nothing. The
   runner's epilogue switches on the namespace so exactly one of those three readings is
   ever printed.
4. **Write through the same seam the app writes through** — `requireOwner`, which mints
   `ownerName` and `ownerPersonId` as a pair, so no path can produce half of it.

**Alternatives rejected.**

- *A hand-written `UPDATE` by someone with database access.* One production credential on
  a laptop, one run nobody can audit, and no bound at all — the exact trade the runner ADR
  was written to end.
- *Hardcode the two project ids and the owner's Person id.* Shorter, and unverifiable: the
  ids come from a database this branch cannot read, and a stale one writes the wrong owner
  onto the wrong program with no way to notice.
- *Extend `db:backfill:owner-person` to guess when nothing matches.* It would destroy the
  property that arm is valued for (ADR `a-name-to-fk-backfill-writes-only-the-unambiguous`)
  and put a guess behind a name that promises not to guess.
- *Fix the two rows through the app's own UI.* Legitimate, and what the bead first proposed
  — but it needs a human, in prod, remembering which two programs and re-running the
  backfill afterwards. The bound and the report are cheaper than the memory.
- *No bound, on the grounds that the WHERE clause is already narrow.* The WHERE clause
  encodes what is true today; the bound encodes what was REVIEWED.

**Consequences.** A third namespace on the runner, so its epilogue and the runbook now
carry three readings of an exit code instead of two — paid once, in one `case`. The arm is
one-shot by intent but idempotent by construction (a repointed row leaves the scan, and
every UPDATE requires the owner id to still be NULL), so nothing has to be deleted after
it runs; it simply reports nothing to do. The owner it picks is self-reinforcing — the
winner gains the repointed programs and would win again — which is stability for mock rows
and would be a bias to revisit if this rule were ever used on real ownership.

**Receipts.** Bead `autoknow-pro.2`, gating `autoknow-mnr` (#127 E7); extends ADR
`a-backfill-reaches-prod-through-an-allowlisted-dispatch-runner`. Rehearsed end-to-end
against a local scratch database seeded to prod's shape (11 programs, 9 linked, `Alice PM`
and `Clara Operations` unmatched at #2 and #3): `owner-person` reproduced
`unmatched: 2`, the arm repointed both and printed before/after for each, an immediate
re-run reported `Nothing to do`, a re-run of `owner-person` then reported
`unmatched: 0 / ambiguous: 0`, and with a third row made unresolvable the arm exited 1 with
`REFUSED` and left all three rows untouched. NOT proven, as with the runner itself: the
proxy hop, the Secret Manager read and the WIF grant.
