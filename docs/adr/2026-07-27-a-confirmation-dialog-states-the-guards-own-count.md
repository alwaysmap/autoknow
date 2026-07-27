---
status: accepted
date: 2026-07-27
supersedes: ""
superseded-by: ""
extends: ""
extended-by: ""
tags: [ui, dialogs, data-integrity, actions, types]
---

# A confirmation dialog states the GUARD's count, in a shape only the guard can mint

**Context.** The partner delete dialog decided whether a delete was possible from
`partnerRosterAsOf(...).current.length` — the as-of roster, who works here today — while
`deletePartner` refused on `prisma.person.count({ where: { currentPartnerId } })`, the FK
the DELETE would actually break. Both reads are correct for their own question, and
[`currentpartnerid-is-a-cache-affiliations-are-the-truth`](2026-07-26-currentpartnerid-is-a-cache-affiliations-are-the-truth.md)
deliberately keeps deletion guards as the cache's one sanctioned reader. But they are
different questions, so they diverge exactly when the cache is stale — and then the dialog
said nothing was blocking, the user typed the partner name to confirm, and the action
refused. A dialog that promises something the system will not honour is worse than one that
says no (`autoknow-aa7`, found sweeping #127 E12).

**Decision.** A confirmation dialog whose copy or affordances depend on a precondition does
not compute that precondition. One server module answers "what would block this mutation",
the action calls it to decide, the page calls it to render, and the answer crosses to the
client as an opaque value: `lib/partnerDeletion`'s `PartnerDeleteBlockers` carries a
`unique symbol` brand, so `blockers={{ programCount: n, employeeCount: m }}` assembled at a
call site does not type-check. The dialog cannot form a second opinion, because it cannot
form an opinion at all.

The direction of the fix follows from what each side is FOR: the guard is answering
referential integrity, so it asks the reference; the dialog is a pre-flight OF the guard, so
it asks the guard. The employee FIGURE above the people table is still the roster — that one
is a display, and it may legitimately differ from the number in the dialog. The dialog's copy
now says which it is ("person record(s) still name this partner as their employer, including
anyone whose move has not been recorded"), so a refusal is legible beside a table showing
nobody current.

**Alternatives rejected.**

- *Make the guard read the as-of roster, so the dialog's number wins.* It would let a delete
  through for a person whose `currentPartnerId` still points at the partner, and Postgres
  would refuse the transaction with a constraint violation the user cannot act on. It also
  makes the guard's honest question un-askable.
- *Leave both reads and add a test that they agree.* They CANNOT agree — they answer
  different questions, and the stale window is a real state this app renders on purpose. A
  test would have to encode the divergence as expected, which is the defect written down.
- *A plain interface instead of a branded one.* An interface documents the contract and
  enforces nothing: a literal with two hand-counted numbers satisfies it, which is exactly
  how the divergence was authored the first time (AGENTS lesson 2).
- *Export the helper as a server ACTION from `app/actions/partners.ts`* (the bead's first
  suggestion). Every export of a `'use server'` module is a network-reachable endpoint; a
  row-count oracle for arbitrary partner ids is not something to publish to fix a dialog.

**Consequences.**

- The partner page runs one extra `count` pair per render, and stops deriving `ownedCount`
  by filtering `getPartnerPrograms` — a second implementation of the guard's `project.count`
  that agreed only for as long as nobody changed one of them.
- The two numbers on the page may now differ visibly, and that is the honest state: the
  people table can be empty while the delete dialog says one record still points here.
- The brand costs one `as` assertion, inside the module that mints the value.
- The rule generalises to the next guard with a pre-flight, and the sweep found no other
  today: `deleteTemplate` gates the UI on `isBuiltIn`, the same single column its guard
  reads, and every other destructive action in the app (project, person, feed item, phase
  dependency, phase partner/person) refuses nothing, so its dialog promises nothing.

**Receipts.** `autoknow-aa7`; the divergence was found by PR #217 (`c189f4d`).
`tests/partnerDeleteBlockers.test.ts` builds the stale cache in BOTH directions and asserts
the blockers predict what `deletePartner` does; `tests/partners.spec.ts` "delete refuses for
a person whose record still points here" drives the rendered dialog. The brand was verified
by mutation — a hand-rolled literal fails `npm run typecheck` with
"Property '[blockersBrand]' is missing".
