-- #127 E9 — unique-at-an-instant. The CONTRACT step of the Email cluster (#124 §2, §5
-- row 4): `Person.email @unique` said "one address, one human, forever", which is false.
-- What is true is that no two people hold one address AT THE SAME MOMENT, and that is a
-- statement about employment periods, so it moves to PersonAffiliation as an exclusion
-- constraint.
--
-- allow-destructive: drops the Person.email unique index (superseded by the exclusion
-- constraint below) and rewrites both address columns to their canonical lower-cased
-- form. Both are one-way; the contract half of an expand→contract that began with #127
-- E8's column. `scripts/ci/lint-migrations.sh` learned to demand this tag for a DROP
-- INDEX and for an in-migration UPDATE in the same PR — a data rewrite inside
-- `migrate deploy` is exactly what the playbook keeps backfills out of it to avoid, so
-- doing one deliberately means saying so where a reviewer reads it.
--
-- STATEMENT ORDER IS THE SAFETY ARGUMENT, so please do not reorder:
--   1. the extension, because 5 cannot be written without it;
--   2. the DROP, BEFORE 3 — lower-casing a column that is still `@unique` is the one
--      way this migration could fail on data nobody has looked at (two rows differing
--      only in case would collide the instant they are folded together);
--   3. the canonicalization, which is what makes 5's `=` mean the same thing the app
--      means (`normalizeAddress` in src/lib/auth.ts);
--   4. a preflight that RAISES with the offending rows named, so that if 5 is going to
--      fail, the deploy log says which two people and which address rather than
--      "conflicting key value violates exclusion constraint";
--   5. the constraint.

-- CreateExtension
-- Same privilege as `vector` in 0_init, which `migrate deploy` has been creating on this
-- instance since the first release: both are Cloud SQL "supported extensions" and need
-- cloudsqlsuperuser, which the `app` migration role holds and the `app_runtime` role does
-- not. Nothing about the runtime role changes — an extension is DDL, runtime does no DDL,
-- and a constraint is enforced by the server against every role regardless.
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- DropIndex
DROP INDEX "Person_email_key";

-- Canonicalize BOTH columns that hold an address, so the constraint below compares like
-- with like and so the app's exact-match clash check (`addressHolderAsOf`) finds what the
-- constraint's `lower()` would. `Person.email` was never canonicalized on write, and
-- folding it retroactively is taken HERE because this is the one migration where there is
-- no unique index left for the fold to violate (ADR
-- an-address-is-unique-at-an-instant-not-forever). `PersonAffiliation.email` HAS been canonical on
-- write since it existed (#127 E8), so its statement should touch nothing; it is here
-- because "should" is not "does", and a claim the schema relies on is worth making true
-- rather than believing.
UPDATE "Person"
SET "email" = lower(btrim("email"))
WHERE "email" <> lower(btrim("email"));

UPDATE "PersonAffiliation"
SET "email" = lower(btrim("email"))
WHERE "email" <> lower(btrim("email"));

-- Preflight: name the conflicts instead of letting the ALTER TABLE below discover them.
-- A failed migration blocks the deploy of every change merged alongside it, so the one
-- thing worth buying here is that whoever reads the failure knows what to fix. Runs
-- inside the migration's transaction, so a raise leaves nothing behind.
DO $$
DECLARE
  pairs bigint;
  conflicts text;
BEGIN
  WITH conflicting AS (
    SELECT format('  %s: person %s (period %s) vs person %s (period %s)',
                  lower(a."email"), a."personId", a."id", b."personId", b."id") AS line
      FROM "PersonAffiliation" a
      JOIN "PersonAffiliation" b
        ON a."id" < b."id"
       AND a."personId" <> b."personId"
       AND lower(a."email") = lower(b."email")
       AND tsrange(a."startDate", a."endDate") && tsrange(b."startDate", b."endDate")
     WHERE a."email" IS NOT NULL AND (a."endDate" IS NULL OR a."endDate" > a."startDate")
       AND b."email" IS NOT NULL AND (b."endDate" IS NULL OR b."endDate" > b."startDate")
  )
  SELECT count(*), string_agg(line, E'\n' ORDER BY line) INTO pairs, conflicts FROM conflicting;

  IF pairs > 0 THEN
    RAISE EXCEPTION
      'unique-at-an-instant: % period pair(s) record one address against two different people over overlapping time. NO DATA WAS CHANGED — this transaction rolled back.', pairs
      USING DETAIL = E'\n' || conflicts,
            HINT = 'RECOVERY, in order: (1) `prisma migrate resolve --rolled-back 20260727040058_unique_at_an_instant`, or every later deploy dies with P3009 on this same migration; (2) run the "Run DB backfill" workflow with backfill=email-conflicts for the same report read-only; (3) decide which person held each address then and correct the other period; (4) re-deploy. See docs/OPERATIONS.md, "The backfills, and what their reports mean".';
  END IF;
END $$;

-- The constraint. `WHERE` excludes periods that cover no instant at all — a NULL address
-- says nothing, and a period ending at or before its own start is empty, so neither can
-- name a person at a moment. Excluding them is not a loophole: it is the only reading
-- under which `tsrange` is even constructible for such a row.
ALTER TABLE "PersonAffiliation"
  ADD CONSTRAINT "PersonAffiliation_email_unique_at_an_instant"
  EXCLUDE USING gist (
    (lower("email")) WITH =,
    "personId" WITH <>,
    tsrange("startDate", "endDate") WITH &&
  ) WHERE ("email" IS NOT NULL AND ("endDate" IS NULL OR "endDate" > "startDate"));
