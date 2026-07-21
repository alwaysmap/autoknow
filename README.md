# AutoKnow

A relationship and project tracking system for Android Automotive Partner Engineering.

> **Doc map** — this file covers local development. Everything else:
> [docs/OPERATIONS.md](docs/OPERATIONS.md) (running & configuring a deployment; §9 = deploy/rollback runbook) ·
> [docs/DEPLOYMENT_GCP.md](docs/DEPLOYMENT_GCP.md) (GCP architecture & CI/CD) ·
> [docs/CHANGE_PLAYBOOK.md](docs/CHANGE_PLAYBOOK.md) (**mandatory** before schema/infra changes) ·
> [docs/design.md](docs/design.md) (UI rules) · [AGENTS.md](AGENTS.md) (ground rules for AI agents)

## System Architecture

One Next.js app on Cloud Run, one Postgres, three ways work arrives. (Full
design rationale: [docs/DEPLOYMENT_GCP.md](docs/DEPLOYMENT_GCP.md).)

**Flow 1 — a person loads a page**

```
 Browser ───GET /programs/42───▶ Cloud Run: autoknow (Next.js standalone)
    │                              │ 1. session gate (next-auth ⇄ Google OAuth;
    │                              │    domain-restricted by AUTH_ALLOWED_DOMAIN)
    │                              │ 2. server components query via Prisma (pg)
    │                              ▼
    │                            Cloud SQL Postgres 16 + pgvector
    │                              (unix socket /cloudsql/…, no public IP)
    ◀───rendered HTML/RSC──────────┘
    A visible summary that is missing/stale regenerates once on mount:
    SummaryPanel ──▶ Gemini API ──▶ new Summary row (append-only) ──▶ re-render
```

**Flow 2 — the hourly refresh worker**

```
 Cloud Scheduler ──GET /api/cron/refresh (Authorization: Bearer CRON_SECRET)──▶ Cloud Run
                                                                                  │
   pg advisory lock (single-flight: overlapping ticks no-op) ─────────────────────┤
   1. runDriveSync()     Drive API (service account) — ingest/refresh shared Docs │
   2. runRefreshCycle()  re-fetch watched web/tracker sources (content-hash gated)│
   3. runSummaryCycle()  regenerate MISSING → STALE summaries via Gemini (cap 10) │
                                                                                  ▼
   all writes → Cloud SQL · JSON report → Cloud Logging (see OPERATIONS §10)
```

**Flow 3 — Google Chat ingestion**

```
 Googler picks @AutoKnow in a Chat space
    │
    ▼
 Google Chat (Workspace add-on runtime)
    │  POST /api/chat/events — Google-signed ID token
    ▼
 Cloud Run: verify token (audience = GCP project number)
    │  save thread as ContextUrl revision (re-mentions = new revisions)
    │  Gemini digest + embedding ──▶ Cloud SQL (feeds search + summaries)
    ▼
 reply posted back in-thread (add-on createMessageAction envelope)
```

Deploys are a fourth flow, but a boring one by design: merge to `main` →
GitHub Actions (`migrate` → `deploy`, serialized) → new Cloud Run revision.
See §7 below and [docs/OPERATIONS.md](docs/OPERATIONS.md) §9–§10.

## Development Workflow

**`npm run` is the single entry point for every dev, test, database, and CI task**
— humans, agents, and the GitHub workflows all go through these (the `ci:*`
scripts wrap `scripts/ci/*.sh` and need CI-provided GCP env, so they're not for
local use):

| Script | What it does |
|---|---|
| `dev` / `build` / `start` | Next.js dev server / production build / serve the build |
| `demo` | One command: per-worktree seeded demo DB + `next dev` with stub auth + mock data (`--reseed` to refresh) |
| `lint` / `typecheck` | ESLint / `tsc --noEmit` |
| `test` (`:watch`, `:coverage`) | Jest unit + DB tests against the `*_test` database |
| `test:e2e` (`:ui`) | Playwright: full suite on Chromium + engine-sensitive specs on WebKit (own server on a per-worktree port, own per-worktree `*_test` DB) |
| `test:e2e:screens` | opt-in: capture UI screenshots into `./screenshots` for visual review |
| `evidence` | The full local gate: typecheck → lint → coverage → e2e → build |
| `db:up` / `db:down` | Start / stop the local Postgres container |
| `db:generate` | Regenerate the Prisma client (run automatically by `npm ci`) |
| `db:push` | Sync schema to the **local** dev DB (never prod — see playbook) |
| `db:migrate` | Create/apply a migration locally (`prisma migrate dev`; playbook §D) |
| `db:migrate:deploy` | Forward-only `prisma migrate deploy` against `DATABASE_URL` (sandbox/scratch DBs) |
| `db:seed` | Prisma seed (mock data; wipe-guarded — see OPERATIONS §1) |
| `db:studio` | Prisma Studio on :5555 |
| `db:test:clean` | Drop stray per-worktree `autoknow…_test` DBs (skips in-use; never the dev/demo DBs) |
| `ci:lint-migrations` | PR gate: block destructive migrations (used by `ci.yml`) |
| `ci:migrate` | Forward-only `prisma migrate deploy` to Cloud SQL (used by `deploy.yml`) |
| `ci:deploy` | Build → push image → roll Cloud Run (used by `deploy.yml`) |
| `ci:harden-db` | Diagnose/apply the least-privilege DB role (used by `harden-db.yml`) |

### 1. Prerequisites
- Node.js (v18+)
- Docker and Docker Compose (for the PostgreSQL database with pgvector)

### 2. Starting the Application
First, create your `.env` from the sample. `DATABASE_URL` is the only required
variable — everything else is optional and gates a specific feature (see
[docs/OPERATIONS.md](docs/OPERATIONS.md)):
```bash
cp .env.sample .env
```

Start the local database container:
```bash
npm run db:up
```

Push the Prisma schema to initialize your database:
```bash
npm run db:push
```

Start the Next.js development server (http://localhost:3000):
```bash
npm run dev
```

### 3. Testing
This project strictly enforces TDD (Test-Driven Development). Any new code changes must have tests written first. We use black-box behavioral testing to ensure we test expectations, not implementation details.

Jest runs serially against a dedicated `<name>_test` database (derived from
`DATABASE_URL`); it can never touch your main database.

**Unit and Component Tests (Jest):**
```bash
npm run test
npm run test:watch
npm run test:coverage  # Generate a coverage report
```

**End-to-End Tests (Playwright):**
The Playwright config starts its own dev server on a **per-worktree port** (~3130,
derived in `tests/helpers/worktree`) with its own **per-worktree** `_test` database
and a separate `.next-test` build dir, so it never disturbs a dev server you're
running on :3000 and two worktrees' e2e runs never collide. The browser matrix is
deliberate: Chromium runs the full suite; WebKit re-runs only the engine-sensitive
specs (dialogs, month/range inputs, SVG drag). Screenshot capture is a separate
opt-in project.
```bash
npm run test:e2e          # chromium (all) + webkit (engine-sensitive specs)
npm run test:e2e:ui       # Opens the Playwright interactive UI
npm run test:e2e:screens  # UI screenshots into ./screenshots (no assertions)
```

### 4. Ecosystem Summary Dashboard
The `/ecosystem-summary` page provides a unified deterministic + AI-driven synthesis of the entire partner engineering project portfolio:
- **p85 Lead Time**: Tracks the 85th percentile duration of active BSP/VHAL integration phases.
- **Monte Carlo Forecast**: Runs 1,000 statistical simulations on remaining uncompleted phases to output likely (+p85) and risk-bound (+p95) completion timeframes.
- **AI Status Synthesis**: Unified briefing summarizing active program blockers (e.g. supplier board delays) ingested from program notes.

**Ingesting Status Updates via Chat Webhook:**
You can post a project briefing from Google Chat to the integration endpoint `/api/integrations/chat`. On a deployment with auth configured, pass `x-admin-token` (the route requires a session or a valid admin token — it is never open):
```bash
curl -X POST http://localhost:3000/api/integrations/chat \
  -H "Content-Type: application/json" \
  -H "x-admin-token: $ADMIN_TOKEN" \
  -d '{"message": "@autoknow status update for \"Waymo Generation 6 AAOS\": BSP is green. Audio HAL integration is blocked due to codec samples from supplier."}'
```
This automatically parses the target program and records the status through the ingest pipeline (digest, embedding, revision history) for RAG-driven synthesis.

### 5. Database Management
```bash
npm run db:up      # Starts the postgres container in the background
npm run db:down    # Stops and removes the database container
npm run db:push    # Pushes schema changes to the database (LOCAL dev DB only)
npm run db:studio  # Opens Prisma Studio on port 5555 to view/edit database contents
```

`db:push` is for the local throwaway database only. Production is forward-only
`prisma migrate deploy`, run by CI — schema changes ship as committed migrations.
Read [docs/CHANGE_PLAYBOOK.md](docs/CHANGE_PLAYBOOK.md) before touching
`prisma/schema.prisma`.

### 6. Production Build
The dev server is not suitable for long-running use (it accumulates memory); serve
a production build instead. `npm run start` serves on :3000; add `-- -p <port>` to
change it (env vars are read at boot, so restart after editing `.env`).
```bash
npm run build
npm run start            # http://localhost:3000
# or: npm run start -- -p 3100
```

### 7. Production Deployment (GCP)

Production runs on Cloud Run at https://autoknow.alwaysmap.com and deploys
**automatically on merge to `main`**: `.github/workflows/deploy.yml` runs
forward-only `prisma migrate deploy`, then builds and rolls the Cloud Run service.
Deploys are serialized (a workflow concurrency group), so the newest merge always
wins. Note the workflow's path filter: docs-only changes do not trigger a deploy.

- Architecture and CI/CD design: [docs/DEPLOYMENT_GCP.md](docs/DEPLOYMENT_GCP.md)
- Operating it — env, integrations, **redeploy & rollback runbook**: [docs/OPERATIONS.md](docs/OPERATIONS.md) (§9)
- **Monitoring & logs** — health endpoint, log tailing, dashboards: [docs/OPERATIONS.md](docs/OPERATIONS.md) (§10)
- Rules for schema/infra changes: [docs/CHANGE_PLAYBOOK.md](docs/CHANGE_PLAYBOOK.md)

Health probe: `GET /api/health` (public) returns `{ ok, sha, db }` — `sha` is the
commit the running build was made from.
