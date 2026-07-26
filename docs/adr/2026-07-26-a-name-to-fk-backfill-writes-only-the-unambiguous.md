---
status: accepted
date: 2026-07-26
supersedes: ""
superseded-by: ""
extends: ""
extended-by: ""
tags: [data-integrity, identity, migrations, backfill]
---

# A name→FK backfill writes only the unambiguous match, and reports the rest

**Context.** #124 §5 turns three free-text people references into foreign keys, and
`Project.ownerName` → `ownerPersonId` (#127 E6) is the first. The text being converted
was written by `resolvePerson`, which resolves a handle or name through three tiers —
exact email, then email local-part, then exact full name — and returns the FIRST hit at
the first tier that matches. That is a guess, and for a live form it is the right one:
the picker only offers real people, a near-miss is worth taking, and whoever is looking
at the screen can correct it. A backfill inherits none of that. Nobody is looking, the
guess is written once and then read forever as if it were a fact, and two of the tiers
are genuinely ambiguous — one local part can belong to two partner addresses, and two
people can share a name.

**Decision.** A backfill that resolves a name to an entity **writes only when the answer
is unique, and leaves every other row NULL with a line in a report.**

1. Ask the SAME matcher the write paths use — never a second, SQL-shaped copy of it.
   Here that meant adding `resolvePersonCandidates` to `src/lib/people.ts` (all matches
   from the winning tier) and re-expressing `resolvePerson` as its first element, so the
   two questions cannot drift apart.
2. Zero candidates → NULL, reported as unmatched. Two or more → NULL, reported as
   ambiguous, naming the people it could have meant.
3. The script is idempotent, batched by resolved person, and re-runnable — its `WHERE`
   requires the FK to still be NULL, so a second run is a no-op and a row becomes
   linkable the moment somebody fixes its text.
4. It is a separate `npm run db:backfill:*` script, never a statement inside
   `migrate deploy` (docs/CHANGE_PLAYBOOK.md) — a decision with leftovers needs an
   operator reading them, which a migration has no way to produce.

NULL is safe precisely because the change is an EXPAND: the text column is untouched and
remains the read path. The contract step's precondition is the report reaching zero, not
the migration having run.

**As-of, stated because #127 makes it a live question.** The resolution happens as of the
RUN instant, against each Person's current `email` and `name`. Those are person-level
columns (#124 §2 — name is latest-wins, email becomes period-scoped only in Phase 3), so
there is no historical address to resolve against and no date at which the directory
would look different; nothing here touches `PersonAffiliation`, and the as-of resolvers
are not involved. The consequence is honest and worth stating rather than hiding: a
program whose `ownerName` holds an address its owner has since left resolves to nobody
today. That IS #124 Class 4, and it is the second reason the script re-runs.

**Alternatives rejected.**

- *Let the backfill call `resolvePerson` and take its first match.* It picks by array
  order, i.e. by whatever `findMany` returned — so the same data could link a program to
  a different human on a different day. A wrong owner is worse than no owner while the
  text still says who it is.
- *Resolve in SQL inside the migration.* Faster to write and immediately wrong: it is a
  second implementation of the three tiers, in a language where `deriveEmail`'s
  org-domain rule has to be restated, and it can neither report nor be re-run
  (AGENTS lesson 7).
- *Fail the migration on any unresolved row.* Turns other people's data quality into a
  deploy outage, for a column nothing reads yet.
- *Backfill only the exact-email tier and skip the rest.* Would leave every pre-seam row
  (handles, full names) unlinked with no signal that they exist — the report is the point.

**Consequences.**

- Moving readers onto the FK (#127 E7) has an explicit, measurable gate: the backfill
  report shows zero unmatched and zero ambiguous rows. Before this the precondition was
  "we think it worked".
- Every path that ASSIGNS an owner now writes both columns, because `requireOwner`
  returns the PAIR as a spreadable Prisma fragment (`{ ownerName, ownerPersonId }`) and
  no seam yields the email alone. Dual-write is structural, not remembered. Deleting a
  person is the one deliberate asymmetry: it clears the id and keeps the text, the same
  way it already did for `ActionItem.assignedTo`.
- The same three rules are what E8 and E9 should copy; the ambiguity signal already
  exists for them in `resolvePersonCandidates`.

**Receipts.** #127 E6 (bead `autoknow-4nh`), migration
`20260726232108_project_owner_person_id`. Verified by `tests/ownerBackfill.test.ts`
(unmatched and ambiguous rows stay NULL and are named; a second run links nothing and
changes no row; a corrected `ownerName` links on re-run), `tests/resolvePerson.test.ts`
(candidates vs. first-wins), and a scratch-database run showing 3 linked / 1 unmatched /
1 ambiguous, then 0 linked on the immediate re-run.
