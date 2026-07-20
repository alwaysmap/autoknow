---
name: db-change
description: Any work touching prisma/schema.prisma, migrations, seeding, or data backfills — schema evolution, local DB setup, pgvector.
---

# Database changes

**Read [docs/CHANGE_PLAYBOOK.md](../../../docs/CHANGE_PLAYBOOK.md) in full
before touching the schema** (~150 lines; the PR recipes are exact and
software-enforced — guessing gets blocked by CI or the DB role).

## Local flow (npm scripts only)

```bash
npm run db:up                                        # postgres + pgvector container
npm run db:migrate -- --name <change> --create-only  # writes prisma/migrations/<ts>_<change>/
# → open the generated migration.sql and read EVERY statement
npm run db:migrate                                   # apply locally
npm run test                                         # jest incl. DB tests (own *_test database)
```

`npm run db:push` syncs the LOCAL throwaway DB only. `npm run db:studio` to
inspect. Seeding is the `/admin` console (idempotent core seed vs destructive
mock seed — OPERATIONS §1).

## Non-negotiables (enforced, not advisory)

- **Additive** (new table, nullable/defaulted column, index): ships WITH app
  code in one PR. **Destructive** (drop/rename/retype, NOT NULL w/o default):
  expand → backfill → contract across separate merges; CI fails destructive SQL
  lacking a reviewed `-- allow-destructive: <reason>` tag.
- Prod is forward-only `prisma migrate deploy`, run by `deploy.yml` BEFORE the
  new revision serves — the old revision keeps serving during rollout, so every
  migration must also be safe for the code currently in prod.
- Never edit an applied migration (checksums make deploy fail). Fix forward.
- Guards you will hit by design: the `app_runtime` role has no DDL (schema SQL
  dies with *permission denied*); wipes refuse any non-`*_test` DB unless
  `DESTRUCTIVE_DB_ALLOWED` names it exactly.

## Test databases

`<name>_test` is SHARED by jest and Playwright and wiped per spec file —
never run two suites concurrently, never point a server or demo at it. Need a
sandbox? `CREATE DATABASE x` + `DATABASE_URL=… npx prisma migrate deploy` is
two commands; do that instead (a live demo got wiped mid-session, 2026-07-19).
