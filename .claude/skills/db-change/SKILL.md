---
name: db-change
description: Any work touching prisma/schema.prisma, migrations, seeding, or data backfills — schema evolution, local DB setup, pgvector.
---

# Database changes

This skill IS the schema-change recipe (the playbook,
[docs/CHANGE_PLAYBOOK.md](../../../docs/CHANGE_PLAYBOOK.md), is the compact
human-readable summary + enforcement inventory). The rules are software-
enforced — guessing gets blocked by CI or the DB role.

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

**Docker Compose only:** never install Postgres (or any server) directly on the
host — `npm run db:up` / `db:down` manage the one sanctioned container
(`pgvector/pgvector:pg16` from docker-compose.yml).

**Findings for this surface:** [docs/knowledge/](../../../docs/knowledge/README.md) —
scan the trigger column for `prisma/migrations/**`, `npm run db:migrate`,
`src/lib/seed.ts` and `scripts/**/*.ts` before editing a migration you have
already applied, dating a new fixture, or writing a backfill script that reuses
`src/lib` logic.

## Non-negotiables (enforced, not advisory)

- **Additive** (new table, nullable/defaulted column, index): ships WITH app
  code in one PR — the old revision tolerates an extra column during rollout.
  For an index on a LARGE table, hand-write `CREATE INDEX CONCURRENTLY` and
  mark the migration non-transactional.
- **Destructive/incompatible** (drop/rename/retype, NOT NULL w/o default):
  MUST split across three merges, each deployed healthy before the next —
  1. **Expand**: add the new shape alongside the old; app writes BOTH,
     reads old.
  2. **Backfill**: copy old → new; app reads new, still writes both. Backfill
     scripts are separate from `migrate deploy`, idempotent, batched,
     resumable, guarded by `DESTRUCTIVE_DB_ALLOWED` semantics. **Against prod
     they run one way only** — the manual `Run DB backfill` workflow, whose
     allowlist (`scripts/db/backfill.sh`) your new `db:backfill:*` script must
     join to be runnable at all ([ADR](../../../docs/adr/2026-07-26-a-backfill-reaches-prod-through-an-allowlisted-dispatch-runner.md)).
  3. **Contract**: nothing reads/writes old → a new migration drops it (this
     one carries the reviewed `-- allow-destructive: <reason>` tag CI demands).
  Why: the old revision keeps serving during every rollout window — a one-step
  rename breaks it live and can lose data.
- Prod is forward-only `prisma migrate deploy` (deploy.yml, before the new
  revision serves). Never edit an applied migration — checksums fail deploy;
  fix FORWARD with a new migration.
- **If a migration fails in CI**: rollout is blocked (`needs: migrate`), prod
  still serves the old revision. Write a corrective migration; never hand-edit
  the failed one, never `migrate reset`. If `_prisma_migrations` and the schema
  disagree, STOP and get a human — don't run `migrate resolve` blindly.
- Guards you will hit by design: the `app_runtime` role has no DDL (schema SQL
  dies with *permission denied*); wipes refuse any non-`*_test` DB unless
  `DESTRUCTIVE_DB_ALLOWED` names it exactly; CI lints new migrations for
  destructive SQL.

## Test databases

`<name>_test` is SHARED by jest and Playwright and wiped per spec file —
never run two suites concurrently, never point a server or demo at it. Need a
sandbox? `CREATE DATABASE x` + `DATABASE_URL=… npm run db:migrate:deploy` is
two commands; do that instead (a live demo got wiped mid-session, 2026-07-19).
