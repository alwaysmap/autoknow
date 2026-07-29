---
title: A sibling worktree's migration reads as drift on your branch — generate on a scratch DB, never reset the shared one
status: current
updated: 2026-07-29
applies_to:
  - prisma/migrations/**
  - npm run db:migrate
  - npm run db:up
symptoms:
  - "prisma says: Drift detected: Your database schema is not in sync with your migration history"
  - "prisma says: The following migration(s) are applied to the database but missing from the local migrations directory"
  - "prisma offers `migrate reset` and warns All data will be lost, before you have written any SQL"
  - "npm run db:up fails: Bind for :::5432 failed: port is already allocated"
verified_by: 'PR #266 (#245 part a) — generated 20260729042623_add_escalations on a scratch DB while a sibling worktree held 20260729024354_summary_chain_fingerprint'
---

# A sibling worktree's migration reads as drift on your branch — generate on a scratch DB, never reset the shared one

**The lesson.** Every worktree's `.env` is symlinked to the main checkout's, so they
all point `DATABASE_URL` at the SAME local `autoknow` database, and only one
Postgres container can hold :5432 (a second `npm run db:up` fails on the port —
that failure is the tell that you are about to share someone's database). So a
migration another branch generated and applied is, from your branch, a row in
`_prisma_migrations` with no file: drift. `prisma migrate dev` refuses to generate
anything until it is resolved and offers `migrate reset` — which would drop the
database a sibling worktree is actively developing against. Do not take it. Point
the generate step at a scratch database instead.

**Why it bites.** `migrate dev` is not a file generator; it reconciles the database
with the migrations directory and only then diffs your schema. That reconciliation
is global to the database, while migration FILES are per-branch — so the two
disagree exactly as often as two branches touch the schema at once, which on
parallel agent work is most of the time. The offered remedy is scoped to the whole
database rather than to your branch's part of it, and nothing in the prompt says
whose data is in there. This is the same fatal remedy as
[editing an applied migration](edited-an-applied-migration-revert-and-reapply-never-reset.md),
reached from a different direction: there you wedged the shared DB yourself, here a
sibling did and your branch is merely the one holding the prompt.

**What to do.** Three commands, no reset, nothing shared is touched:

```
docker exec <pg-container> psql -U postgres -c 'CREATE DATABASE autoknow_<slug>_dev'
DATABASE_URL=…/autoknow_<slug>_dev npm run db:migrate:deploy      # your branch's history, clean
DATABASE_URL=…/autoknow_<slug>_dev npm run db:migrate -- --name <change> --create-only
```

Read the generated SQL, then apply it the same way, and run `npm run db:generate`
afterwards — `migrate dev` does not regenerate the client
([note](db-migrate-does-not-regenerate-the-client-so-typecheck-lies.md)). The
migration file is what you commit; the scratch database is disposable and can be
dropped. Never use one of the `*_test` databases for this — a test run wipes it
mid-work (AGENTS lesson 9).

**How we found out.** Generating the `Escalation` migration for #245: a clean
worktree on a fresh branch, first schema command of the session, and Prisma opened
with "We need to reset the public schema". The drift was one unrelated column
another agent had added on another branch that afternoon.
