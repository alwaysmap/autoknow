---
title: Editing a migration you already applied locally wedges the shared dev DB — revert its effect and delete its row, never reset
status: current
updated: 2026-07-26
applies_to:
  - prisma/migrations/**
  - npm run db:migrate
symptoms:
  - "prisma says: The migration `<name>` was modified after it was applied"
  - "prisma offers `migrate reset` and warns All data will be lost"
  - a migration you have not merged yet, edited after running db:migrate once
verified_by: 'PRs #155 and #170 — hit twice in one session, recovered both times without a reset; scripts/ci/lint-migrations.sh'
---

# Editing a migration you already applied locally wedges the shared dev DB — revert its effect and delete its row, never reset

**The lesson.** `db-change`'s rule is *never edit an applied migration*, and it is
about prod. Locally you will still do it — you generate a migration with
`--create-only`, apply it, then a review asks for a comment in the SQL. The moment
you do, `prisma migrate dev` refuses to move and offers exactly one remedy:
`migrate reset`, which drops the whole database.

**Take the offer and you wipe someone else's work.** The dev database on
`localhost:5432` is shared by every worktree on the machine, and the container may
belong to a different checkout entirely than the one you are standing in.

**Why it bites.** Prisma stores a **checksum of the file contents** in
`_prisma_migrations`. Any edit changes it, including a comment-only edit, so the
mismatch is not evidence of anything dangerous — it is bookkeeping. But Prisma
cannot tell a comment from a dropped table, so it reaches for the biggest hammer.
The migration is unmerged and local-only at this point, which is precisely why a
targeted fix is safe here and would not be on a shared or prod database.

**What to do.** Undo exactly what the migration did, forget it was applied, and
re-apply the edited file:

```sql
-- 1. reverse the migration's own effect (whatever it was)
ALTER TABLE "ContextUrl" DROP COLUMN IF EXISTS "truncated";
-- 2. forget it ran
DELETE FROM _prisma_migrations WHERE migration_name = '20260725225736_lossy_truncation_flag';
```

then `npm run db:migrate`, which applies the edited file cleanly and records the new
checksum. Do **not** hand-edit the stored `checksum` — that leaves the recorded
state and the file agreeing about a migration that never ran in that form.

Two things that make this safe to do and unsafe to generalise: the migration is
**not merged** (nothing else has applied it), and you are reversing **your own**
statement, so you know its exact inverse. If either is untrue — it is on `main`, or
you are unsure what it did — stop and get a human, exactly as the `db-change` skill
says when `_prisma_migrations` and the schema disagree.

**How we found out.** Twice in one session. In #58 a review asked for the CREATE and
DROP to be reordered with an explanatory comment; in #56 a review asked the migration
to carry what-and-why like its two neighbours. Both edits were comment-and-order
only, both wedged the dev DB, and both were recovered this way. The tempting
alternative — decline the review finding so the file stays untouched — trades a
five-line recovery for a permanently worse migration.
