---
title: A Postgres service container reports healthy before it accepts TCP — the DB layer must retry the connect
status: current
updated: 2026-07-23
applies_to:
  - .github/workflows/ci.yml
  - src/lib/pgPool.ts
  - src/lib/db.ts
  - tests/helpers/db.ts
symptoms:
  - "CI e2e/jest fails with PrismaClientKnownRequestError, code 'ECONNREFUSED' or 'ECONNRESET', on a change that cannot have caused it, and re-runs green"
  - "[WebServer] Invalid prisma.<model>.findMany() invocation … code: 'ECONNREFUSED', or a deleteMany() in test teardown fails the same way"
verified_by: tests/pgPoolRetry.test.ts "withConnectRetry"; reproduced by stopping Postgres mid-query and restarting it (a plain pool fails, createResilientPool rides through); PR that added src/lib/pgPool.ts
---

The CI Postgres service container's health check runs **inside** the container
(`pg_isready`, over the Unix socket). The official image's first boot is two
phases: it starts a temporary server bound to the socket only (`listen_addresses=''`)
to run init, then stops it and restarts listening on TCP. So the socket check can
mark the container **healthy** while a host-side connection to the mapped
`:5432` still gets **ECONNREFUSED** — and while the server finishes starting it
may accept a socket and immediately reset it (**ECONNRESET**). GitHub's health
gate blocks the first *step*, not the moment Prisma first *connects*.

A plain `pg.Pool` does not retry a failed connection, so one blip fails the query
outright. That is the intermittent e2e red that survives green tests and dies on
a re-run — the change is innocent; the DB was briefly unreachable.

The fix is defence in depth, both halves in the PR above:

1. **CI proves TCP readiness from the runner** before anything connects — a
   host-side `pg_isready` + `psql 'select 1'` loop over the mapped port (the
   exact path the app/tests use), plus `-h localhost` on the container health-cmd
   so its own signal is TCP, not socket. Closes the startup window.
2. **The DB layer retries connection *acquisition*** — `src/lib/pgPool.ts`
   `createResilientPool`, used by both `src/lib/db.ts` (the app) and
   `tests/helpers/db.ts` (jest + e2e teardown). It wraps only the *acquire*, then
   dispatches the SQL exactly once, so recovering from a reset never re-runs a
   write. This is why `ECONNRESET` is safe to retry here but would not be if we
   retried whole queries.

Do not "solve" a recurrence by adding Playwright retries — that hides it. The DB
being briefly unavailable is the thing to survive, not to paper over.
