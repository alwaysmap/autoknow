# Documentation map — read the right doc BEFORE acting

| Doc | Read it when… |
|---|---|
| [README.md](README.md) | developing locally: setup, npm scripts, running tests |
| [docs/CHANGE_PLAYBOOK.md](docs/CHANGE_PLAYBOOK.md) | **mandatory** before ANY schema/infra/secret/env change — see next section |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | configuring or operating a deployment: env vars, integrations (Gemini, OAuth, Drive, Chat), refresh worker, custom domain, and **§9 production deploys / redeploy / rollback** |
| [docs/DEPLOYMENT_GCP.md](docs/DEPLOYMENT_GCP.md) | understanding the GCP architecture (Cloud Run + Cloud SQL + Scheduler, keyless CI) and why it is shaped this way |
| [docs/design.md](docs/design.md) | building or changing any UI (see Design Guidelines below) |
| [docs/COMPONENT_PLAN.md](docs/COMPONENT_PLAN.md), [docs/INGEST_FRESHNESS_PLAN.md](docs/INGEST_FRESHNESS_PLAN.md), [docs/PHASE_TEMPLATES_PLAN.md](docs/PHASE_TEMPLATES_PLAN.md) | deep design docs for those subsystems |

Every dev/test/database/CI task is an `npm run` script — the catalog lives in
[README.md](README.md). Use those instead of invoking `next`/`jest`/`prisma`/
`playwright` or `scripts/**` directly; the GitHub workflows go through them too.

# Database & infrastructure changes — STOP and read the playbook

Before any change touching `prisma/schema.prisma`, `infra/terraform/**`, secrets, or env
vars, read **[docs/CHANGE_PLAYBOOK.md](docs/CHANGE_PLAYBOOK.md)** and follow it exactly.
Non-negotiables (full rules + PR recipes in the playbook):
- **Never `prisma db push`, `migrate reset`, or drop/edit an already-applied migration against a
  shared/prod DB.** Production is forward-only `prisma migrate deploy`; `db push` can delete data.
- **Additive schema changes** (new table, nullable/defaulted column, index) may ship with app
  code in **one PR**. **Destructive ones** (drop/rename/retype a column) MUST be split
  **expand → backfill → contract** across separate merges — one step per deploy.
- **Adding** infra the app needs: infra PR + `terraform apply` (human) FIRST, then the app PR.
  **Removing** infra: app PR first, then the infra PR. Gate new features on env presence so they
  stay dark until their infra exists.
- `terraform apply` is human-run; app deploys are automatic on merge to `main`.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Visual & UX Design Guidelines

All visual designs, layouts, and UX interaction patterns must adhere strictly to the rules documented in [docs/design.md](docs/design.md). Key patterns:
* **Everything is a URL**: Avoid plain-text entity displays. Hyperlink all partners, suppliers, phase markers, and LDAP names.
* **Tufte Visual Cleanliness**: Maintain high data-ink ratios; no redundant borders or blocky layouts.
* **Percentage-Free Gauges**: Never display numeric progress percentages or risk strings inside interactive dial gauges or hill charts.
* **2-Column Sidebar Layout**: Use side-by-side grids for detail panels to maximize screen utility and prevent layout empty spaces.

# Compounding lessons — each cost a real incident or rework cycle here

Rule first, receipts after. Follow these; extend this list when you earn a new one.

1. **A green pipeline is not a deploy.** Parallel deploy runs finish out of order
   and the last `gcloud run services update` wins: five merges on 2026-07-20 left
   prod serving the OLDEST commit while every newer run showed green.
   `deploy.yml`'s concurrency group is the fix — never remove it. Verify deploys
   with `curl -s https://autoknow.alwaysmap.com/api/health` (`.sha` = running
   commit), not with the Actions UI.

2. **Enforce rules in software, not prose.** Every "never do X" that matters here
   fails closed: wipes refuse non-`*_test` DBs unless `DESTRUCTIVE_DB_ALLOWED`
   names the DB exactly; the `app_runtime` DB role has no DDL, so `db push`
   against prod dies with *permission denied*; destructive migrations fail CI
   lint without a reviewed `-- allow-destructive:` tag. When you introduce a new
   dangerous operation, ship its guard in the same PR.

3. **Entity references are pickers + canonical keys, never free text.**
   `Project.ownerName` began as a text input; it accumulated emails, handles, and
   display names, and every consumer needed heuristic matching (PR #11 cleaned it
   up). A field naming another entity gets (a) a select over existing rows and
   (b) server-side resolution that rejects non-matches (`requireOwnerEmail` /
   `resolvePerson` pattern) — at the mutation boundary, not just in the form.

4. **Machine endpoints need BOTH a session-gate exemption and their own auth.**
   The proxy's login redirect silently broke `/api/cron` (a2fb23a), then Chat.
   New machine route = add it to `isPublic` in `src/proxy.ts` AND give it its own
   credential (`CRON_SECRET` bearer, Chat JWT, deliberately-none for `/api/health`).
   One without the other is either broken or exposed.

5. **Gate features on config presence; degrade honestly.** `authConfigured` /
   `driveConfigured` / `chatConfigured`: missing env ⇒ the feature is dark with a
   truthful message ("AI summaries are off"), never a crash, spinner, or faked
   result (fb261f7 replaced an endless spinner with an honest empty state). This
   is what makes the playbook's infra-first ordering safe to follow.

6. **Google-side state is sticky and propagates slowly — get ground truth from
   Google's logs, not yours.** Chat app config survives disabling the API;
   Workspace admin toggles take up to 24h; delivery can fail before any HTTP
   call reaches you (error code 13 + zero requests in your logs = their side).
   Wait out propagation before judging a test, and read the commands in
   OPERATIONS §6 instead of re-deriving them.

7. **When you fix a defect, grep for its siblings before closing.** The
   oversized product-checkbox label existed twice in different forms: a missing
   inline style in one file, and a `styles.checkboxLabel` referencing a CSS
   class that didn't exist in another (CSS-modules misses are silent — you get
   `undefined`, no error). Same bug, two files, one grep apart (PR #12).

8. **Browser-only state needs hydration-safe reads.** localStorage-via-
   setState-in-effect trips the react-hooks lint and cascades renders; the
   pattern is `useSyncExternalStore` with a neutral server snapshot
   (ThemeToggle). Same family: e2e first-interactions must be hydration-guarded
   retry loops (eda5030) — clicking a rendered-but-not-hydrated button is this
   suite's #1 flake source.

9. **The `*_test` database is shared and wiped.** Jest and Playwright both bind
   `<name>_test`, every spec wipes it in `beforeAll`, and `workers=1` is
   load-bearing. Never run two suites concurrently, and never point a demo or
   dev server at it — a concurrent run wiped a live demo mid-session
   (2026-07-19). Scratch DBs are one `CREATE DATABASE` + `prisma migrate deploy`
   away; make one instead.

10. **Docs state their status or they lie.** Two plan docs still said "Plan only
    — no code written yet" while their code ran in production. A PR that
    implements or retires anything a doc describes updates that doc's STATUS
    line in the same PR. The doc map above says which doc owns what.

11. **Commit messages are the database this very section was mined from.**
    Record diagnosis + evidence, not just the change: "heap-profiled 2026-07-17,
    ~10MB/s promise-tracking garbage" (7f05179) is why that OOM fix is
    trustworthy and re-discoverable. "Fix bug" compounds nothing.

12. **Red-team plans before building them.** The freshness feature shipped as
    "v2 = v1 after adversarial review — 10 gaps fixed, 4 mechanisms simplified
    away" (33534f3). The review's job is to DELETE work; prefer removing
    mechanisms over adding them, then build.
