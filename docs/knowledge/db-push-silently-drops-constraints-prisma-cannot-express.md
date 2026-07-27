---
title: A test database built by `prisma db push` silently lacks every constraint Prisma cannot express
status: current
updated: 2026-07-27
applies_to:
  - prisma/migrations/**
  - tests/helpers/provisionTestDatabases.ts
symptoms:
  - a jest/Playwright test happily writes a row production would refuse
  - a constraint added by hand in a migration has no effect in any test
  - '`SELECT … FROM pg_constraint` finds it in the dev database and not in `*_test`'
verified_by: 'tests/uniqueAtAnInstant.test.ts "is actually present in this database"; PR for #127 E9'
---

# A test database built by `prisma db push` silently lacks every constraint Prisma cannot express

**The lesson.** The `*_test` databases are built with `prisma db push`, which syncs
`schema.prisma` — not the migration history. Anything a migration writes **by hand**
because Prisma has no syntax for it (an `EXCLUDE` constraint, a partial or expression
index, a `CHECK`) is therefore absent from every test database. Tests then pass writes
that production rejects, and they do it quietly: the assertion under test succeeds.

**Why it bites.** The two paths are not the same program. `migrate deploy` replays SQL, so
it carries whatever was written; `db push` diffs a schema file that cannot represent the
statement at all, so there is nothing to carry. Nothing warns you — Prisma is not failing,
it is doing exactly what it is for. And the failure is inverted from the usual one: the
suite goes GREEN where it should go red, which is the shape of bug that survives review.

**What to do.** Two moves, and the second is the one that lasts.

1. `tests/helpers/provisionTestDatabases.ts` replays the unmanaged statements after
   `db push`, reading them **out of the migration files** so there is one spelling. It
   currently extracts `ALTER TABLE … ADD CONSTRAINT … EXCLUDE …`; a new statement kind
   needs its pattern added there, or it is invisible everywhere but production.
2. **Assert the constraint exists**, in the suite that depends on it — one query against
   `pg_constraint`. A rejection test proves nothing when the thing doing the rejecting
   might not be there; that assertion is what turns a silent green back into a red.

Do not reach for "just use `migrate deploy` for tests" — these databases are created and
wiped constantly, `db push` is seconds against a replay of the whole history, and the
drift it introduces is exactly one statement kind.

**How we found out.** #127 E9 was the first constraint in this repo that Prisma cannot
express, and the gap was caught by reading `provisionTestDatabases.ts` before writing the
tests rather than by a failure — which is the point of writing it down. Had it not been,
the suite would have gone green while asserting nothing: every "the database refuses this"
case would have been refused by nothing at all, and a green run is not a thing anyone
goes back and interrogates.
