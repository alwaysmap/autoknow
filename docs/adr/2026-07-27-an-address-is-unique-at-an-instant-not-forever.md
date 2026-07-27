---
status: accepted
date: 2026-07-27
supersedes: ""
superseded-by: ""
extends: "resolution-searches-every-address-and-takes-no-date"
extended-by: ""
tags: [identity, affiliations, temporal, data-integrity, migrations, deploy]
---

# An address is unique at an INSTANT, not forever — and a constraint that cannot be `NOT VALID` ships with the check that clears it

**Context.** `Person.email @unique` claimed one address belongs to one human forever.
That is false in both directions: addresses are reassigned (`tel@partner.com` outlives
whoever answers it), and someone who leaves keeps every artifact that quotes theirs —
which is why #127 E8 made the address a property of an employment PERIOD. The true
invariant is narrower and temporal: no two people hold one address **at the same
moment**. No column modifier can say that; a Postgres `EXCLUDE` over a range can. But an
exclusion constraint **cannot be added `NOT VALID`** — Postgres offers that escape only
for CHECK and FOREIGN KEY — so `ALTER TABLE … ADD CONSTRAINT … EXCLUDE` validates every
existing row synchronously, and one offender is a failed `prisma migrate deploy`, which
runs BEFORE the deploy job and would block the release of everything merged alongside it.
Nobody working on this repo can query production to find out whether it has one.

**Decision.** Three parts, and the third is the one that generalises.

1. **The invariant is `(lower(email) =, personId <>, tsrange(startDate, endDate) &&)`,
   partial on `email IS NOT NULL AND (endDate IS NULL OR endDate > startDate)`.**
   `lower()` because the app's equality folds case (`normalizeAddress`) and a DB-level `=`
   does not; `personId <>` because one person's own periods overlapping is a different
   defect with a different fix (bead `autoknow-2of`, at the mutation boundary); `tsrange`
   because half-open `[)` is #124's interval convention, which is exactly what makes an
   honest handover — she leaves on the 1st, he starts on the 1st — legal.
2. **Both columns holding an address are canonical on write.** `Person.email` was not;
   `PersonAffiliation.email` was. The migration folds the existing rows, and it can only
   do that safely THERE: it drops the `@unique` index first, so the one way the rewrite
   could collide is gone before it runs.
3. **A constraint whose validity depends on data nobody can see ships with a read-only
   check and a self-diagnosing preflight.** `npm run db:check:email-conflicts` asks any
   database the question and is an arm of the existing dispatch runner (ADR
   `a-backfill-reaches-prod-through-an-allowlisted-dispatch-runner`) so a human can ask it
   of production keylessly; zero conflicts is the merge gate. The migration then repeats
   the same predicate as a `DO` block that RAISEs with the offending people, periods and
   addresses named, so a skipped check produces a diagnosis instead of `conflicting key
   value violates exclusion constraint` and a blocked release nobody can explain.

**Alternatives rejected.**

- *Add it `NOT VALID` and `VALIDATE` separately* — not available for `EXCLUDE`; the
  planned escape hatch simply does not exist for this constraint type.
- *Remediate inside the migration* (NULL the losing period's address) — a backfill makes
  judgements whose leftovers a human reads, which is precisely why the playbook keeps
  backfills out of `migrate deploy`. Silent data repair during a release is the failure
  mode that rule exists to prevent.
- *Enforce with a `BEFORE INSERT OR UPDATE` trigger* — cannot fail on existing data, so it
  looked attractive, and it is racy by construction: two concurrent inserts each see a
  clean table. A declarative constraint is what "fail-closed" means here.
- *Exempt pre-existing rows* (`WHERE id > <max at migration time>`) — buys a guaranteed
  green deploy by leaving exactly the rows most likely to be wrong unprotected forever,
  and gives prod a different constraint definition from every other database.
- *Fold `personId` in* (forbid ANY overlapping periods sharing an address) — strictly more
  likely to fail on data nobody has looked at, and it would report a career-shape bug
  through an identity constraint.

**What this reverses in the record it extends.**
`resolution-searches-every-address-and-takes-no-date` says a date on resolution would only
matter for one address naming two humans in two periods, "which is exactly what #127 E9's
unique-at-an-instant constraint exists to make impossible". It does the opposite: a
handover across two *separate* periods is expressly legal, and only the same INSTANT is
forbidden. That record's tie-break — current holder first — is therefore permanent rather
than a stopgap, which strengthens it. Its present-tense "`Person.email` is `@unique`" is
simply now false. (`a-move-is-an-insert-into-a-timeline` carries the pointer too: it
rejects an EXCLUDE constraint as "still wanted (#127 E9)", and E9's constraint
deliberately does not close the overlap hole it means.)

**Consequences.** Two people may now share one address across time, so `resolvePerson`
stays legitimately ambiguous for a handover and keeps its current-holder-first tie-break;
this constraint does NOT make `autoknow-2of` impossible and that bead still needs its own
fix at the API boundary. `updatePerson` writes the address onto the period covering today
as well as onto the person, in one transaction, or the two halves would disagree about the
present; `createPersonAt` names a clash for both creation paths at once, because stamping
the address is what can now collide. `btree_gist` becomes a required extension — same
privilege as `vector` in `0_init`, so no infra change and no change to the DDL-less runtime
role. `scripts/ci/lint-migrations.sh` gained `DROP INDEX` and `UPDATE`, so this migration
demands its own `-- allow-destructive` tag and every later one does too (AGENTS lesson 2 —
the dangerous operation ships its guard). What is deliberately given up: an address
recorded against two people over CLOSED periods has no in-app remedy (bead
`autoknow-164`), which is why the check is a pre-merge gate and not a post-hoc alarm. And
every future constraint of this shape inherits part 3: the check is the merge gate, the
preflight is the safety net.

And it inherits part 3's one awkwardness, which is worth stating rather than rediscovering:
**a gate that ships inside the PR it gates cannot be dispatched from `main`.** The runner's
standing rule is to run from `main`, because a dispatch executes whatever code the ref
carries — but the `email-conflicts` option did not exist on `main` until this merged, so
the first and only run that mattered went out as `--ref feat/127-e9-unique-at-an-instant`.
That is acceptable for a `db:check:*` arm specifically: it only `SELECT`s, as the DML-only
role, so what run-from-`main` protects is not at stake. It is not acceptable for a
`db:backfill:*` arm, and `docs/OPERATIONS.md` now draws that line where the runbook is.

**Receipts.** #127 E9, spec #124 §2 and §5 row 4. Migration
`prisma/migrations/20260727040058_unique_at_an_instant`. Verified by
`tests/uniqueAtAnInstant.test.ts`; the failure path was rehearsed against a scratch
database seeded with a conflict, where `migrate deploy` rolled back with the offending
pair named and the pre-migration schema intact.
