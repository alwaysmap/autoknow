---
status: accepted
date: 2026-07-26
supersedes: ""
superseded-by: ""
extends: ""
extended-by: ""
tags: [people, affiliations, temporal, data-integrity, actions]
---

# Recording a move INSERTS into a career timeline; it never appends to the end of it

**Context.** `movePersonCompany` closed affiliations with `where: { endDate: null }` —
"close whatever is open" — then opened the new period open-ended. That is an APPEND, and
it is only right while the career has nothing recorded after today. Alice with Google
until 1 Nov and Honda open from 1 Nov, moved again effective today, had the HONDA row
closed and Google left running to November: two periods covering today, and `profileAsOf`
returning whichever the plan ordered first (autoknow-pvn). Backdating was worse — it
closed the open period at a date before that period's own start, writing `end < start`.
#127 E14 puts an effective-date field on the person editor, which turns backdating and
correcting from a thing you can do into a thing users will do daily, so the rule has to be
settled before that UI ships on top of it.

**Decision.** A move is an insert at a point on a timeline, and the timeline stays
contiguous around it. Three writes, in `movePersonTo` (`src/lib/profiles.ts`), in one
transaction:

1. **Periods COVERING the move date end there** — selected with `asOfWhere`, the same
   predicate the as-of resolvers read with, so the row a move closes is by construction
   the row every surface calls "the job held then". Plural: nothing in the schema stops an
   overlap (autoknow-2of), and ending all of them heals one rather than preserving it.
2. **A period left EMPTY by that is deleted.** Only a period starting exactly ON the move
   date can be — half-open, `[t, t)` contains no day. Re-recording a move at the same
   effective date is how a user CORRECTS one, and a dropped row that asserted no day is
   not history lost.
3. **The new period ends where the next one begins**, or is open if none follows. This is
   what stops a backdated move overlapping everything after it, and it preserves a move
   already scheduled: today's move to Toyota runs until the November move to Honda, which
   the user recorded and did not ask to cancel.

A move date with no covering period is not an error — it is a hire being backdated in, or
a return from a gap — and only rule 3 applies. And the `currentPartnerId` cache advances
on `coversDay(the period just written)`, not `hasTakenEffect(the move date)`: a backdate
that lands before existing periods opens a period whose date has arrived and whose end is
in the past.

**Alternatives rejected.**

- *Keep "close the open period" and forbid backdating past a scheduled move.* Refuses the
  correction the user most needs and leaves the corrupt state reachable through the
  affiliations API anyway.
- *A move supersedes everything after it.* Deletes a scheduled move nobody asked to
  cancel, silently, from a dialog that says "move".
- *Truncate the covering period and leave the empty row.* `Honda · 1 Nov – 1 Nov` sits in
  the History table forever, and every correction adds another.
- *Enforce non-overlap in Postgres with an EXCLUDE constraint.* Right, and still wanted
  (autoknow-c0m / #127 E9) — but it is a destructive schema change needing
  expand/backfill/contract, and existing data must be de-overlapped first. It would reject
  the bad write; it would not make the right one happen.

**Consequences.** The period arithmetic lives in `lib/profiles` beside the resolvers, so
the write and the reads cannot spell the predicate differently — the reason the fix moved
out of the action rather than being patched in place. E14's dialog gets to be UI over a
settled rule. Two things this does NOT do: it does not stop the affiliations API from
authoring an overlap (autoknow-2of), and it does not reconcile `asOfWhere` comparing
raw instants against `coversDay` comparing UTC days (autoknow-yid).

**Receipts.** Bead autoknow-pvn; `tests/movePersonCovering.test.ts` — six careers where
"open" and "covering" diverge, five of which go red on the old rule.
