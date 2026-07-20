# Change Playbook — how to make correct PRs

**Read this before any change that touches infrastructure or the database.** Getting the
ordering wrong can corrupt data. The rules below are not style preferences; follow them
exactly.

## Enforcement (these rules are software-enforced, not just documented)

Rules only help if they can't be quietly ignored. The controls below make the dangerous
operations fail regardless of who (human or agent) attempts them:

1. **Least-privilege runtime role** (`scripts/db/harden-roles.sql`, verified live): the
   runtime connects as **`app_runtime`** — a plain SQL role with **row DML only, no
   CREATE/ALTER/DROP/TRUNCATE**. `prisma db push` and any schema-destroying SQL run with the
   runtime `DATABASE_URL` fail with *permission denied*. Only the `app` owner role has DDL,
   its credentials (`database-url`) are read only by the CI SA, and it is used solely by
   `prisma migrate deploy`. (On Cloud SQL every API-created user is a `cloudsqlsuperuser`
   member and can't be demoted, so the restricted role is created as a plain SQL role.)
2. **Destructive-migration gate** (`scripts/ci/lint-migrations.sh`, `ci.yml`): a required PR
   check fails any new migration containing `DROP TABLE/COLUMN`, `TRUNCATE`, `SET DATA TYPE`,
   `SET NOT NULL`, etc. unless it carries an explicit reviewed `-- allow-destructive: <reason>`.
3. **Forward-only in CI**: the pipeline only ever runs `prisma migrate deploy`; nothing runs
   `db push`/`reset`. A failed migration blocks the deploy (`needs: migrate`), so prod keeps
   serving the old revision — never half-migrated.
4. **Immutable history**: Prisma verifies each applied migration's checksum; editing an
   already-applied migration makes `migrate deploy` fail.
5. **Backups + PITR** on the Cloud SQL instance: last-resort recovery, always on.
6. **Branch protection** (recommended): require the `migrations-lint` check + review and
   disallow direct pushes to `main`, so nothing reaches prod unchecked.

## The two pipelines (what runs when)

| Trigger | Workflow | What it does | Who can run it |
|---|---|---|---|
| Push to `main` touching app paths | `.github/workflows/deploy.yml` | **migrate** (forward-only `prisma migrate deploy`) → **deploy** (build → push → Cloud Run) | automatic |
| PR touching `infra/terraform/**` | `.github/workflows/terraform.yml` | read-only `terraform plan` | automatic |
| Manual | `terraform.yml` dispatch / local | `terraform apply` | **human only** |

Key facts that dictate everything below:
- **App deploy is automatic on merge; `terraform apply` is NOT.** So infra a new app version
  depends on must exist *before* that app version merges.
- In `deploy.yml`, **migrations run before the new image serves**, but the **old revision keeps
  serving until the rollout finishes** — so every migration must be safe for the *currently
  running* code too.
- The app is written so features **stay dark until their infra exists** (`authConfigured`,
  `driveConfigured`, `chatConfigured`, …). Write new infra-coupled features the same way.

## Golden rules (never break these)

1. **Never `prisma db push` against a shared/prod database.** It reconciles the schema by
   *dropping* whatever doesn't match — it can delete columns and data. Production uses
   `prisma migrate deploy` (forward-only) exclusively. `db push` is for a local throwaway DB only.
2. **Never edit, rename, or delete a migration that has already been applied** (i.e. already
   merged to `main`). Migrations are immutable history. Fix-forward with a *new* migration.
3. **Never `prisma migrate reset` / `migrate resolve --rolled-back` / drop tables** against a
   shared DB. The `DESTRUCTIVE_DB_ALLOWED` guard blocks wipes; do not disable it to "fix" a migration.
4. **Additive/expand migrations only in the same PR as app code.** Destructive schema changes
   (drop/rename/retype a column, drop a table, add a NOT NULL column without a default) must be
   split across multiple merges — see recipe D.
5. **Infra before app for additions; app before infra for removals.**

## Recipes by change type

### A. App-only change (no infra, no schema)
UI, logic, copy, a new route that uses only existing tables/secrets.
- **One PR → merge.** `deploy.yml` builds and rolls out. Done.

### B. App + *adding* infra (new secret, env var, enabled API, IAM role, Cloud Run setting)
The new secret/env/permission must exist before the code that reads it.
1. **PR 1 — infra.** Add the resource in `infra/terraform/` (e.g. a `google_secret_manager_secret`
   + its Cloud Run env mapping, or a new API in the services list). Merge, then **`terraform apply`**
   (human). Verify the resource exists.
2. **PR 2 — app.** Add the code that reads it, **config-gated** (`const fooConfigured = !!process.env.FOO`)
   so it degrades cleanly if the value is ever missing. Merge → auto-deploy.

> Doing both in one PR is unsafe: the merge auto-deploys the app before you've applied the infra,
> and Cloud Run will fail the rollout (missing secret ref) — prod keeps serving the old revision,
> but the deploy is red and the change is half-done.

### C. App + *removing* infra (retire a secret/env/API/permission)
Reverse order — stop using it before it disappears.
1. **PR 1 — app.** Remove all code references. Merge → deploy. The infra is now unused.
2. **PR 2 — infra.** Delete the resource. Merge → `terraform apply` (human).

### D. Database schema change — READ CAREFULLY

Migrations are created locally, reviewed as SQL, committed, and applied by CI. To create one:
```bash
# Against a LOCAL throwaway DB only (never prod):
npm run db:migrate -- --name add_widget_status --create-only   # writes prisma/migrations/<ts>_add_widget_status/
#   → open the generated migration.sql, read every statement, confirm it is non-destructive
npm run db:migrate                                             # apply locally to test
```
Commit the whole `prisma/migrations/<ts>_*/` folder. CI runs `prisma migrate deploy` (forward-only)
before each rollout.

**D1. Purely additive (safe to ship with app code in ONE PR):**
- Add a new table.
- Add a **nullable** column, or a column **with a default**.
- Add an index (for large tables, write it `CREATE INDEX CONCURRENTLY` by hand and mark the
  migration non-transactional).

Because the old revision tolerates an extra table/column, one PR is fine: migrate runs, old code
ignores the addition, then the new code deploys and uses it.

**D2. Destructive or incompatible (MUST be split — expand → migrate → contract):**
Renaming a column, dropping a column, changing a type, adding a `NOT NULL` without default, or
splitting/merging columns. Doing any of these in one step **will break the running old revision**
(it runs against the changed schema during the rollout window) and can lose data. Instead:

1. **Expand (PR 1):** add the new shape *alongside* the old (e.g. add the new nullable column).
   App code writes **both** old and new, reads old. Merge → migrate + deploy.
2. **Backfill (PR 2 or a one-off job):** copy old → new for existing rows. App now reads new,
   still writes both. Merge → deploy.
3. **Contract (PR 3):** once no running code touches the old column, a new migration drops it.
   App code stops writing it. Merge → migrate (drops old) + deploy.

Never collapse these into fewer merges. Each step must be deployed and confirmed healthy before
the next. The column is only dropped when nothing reads or writes it.

**D3. Data migrations (backfills):** prefer an idempotent, batched, resumable script guarded by
`DESTRUCTIVE_DB_ALLOWED` semantics, run deliberately — not inside `migrate deploy` (keep schema and
data migrations separate so a re-run is safe).

### E. Combined app + infra + schema
Sequence the pieces by the rules above — infra-add first (B1), then the schema+app PR (D1 if
additive, or the D2 expand/contract chain), then infra-remove last (C2). When in doubt, split into
more, smaller PRs; never fewer.

## If a migration fails in CI
- The `deploy` job is gated on `migrate` (`needs: migrate`), so a failed migration **blocks the
  rollout** — prod keeps serving the old, healthy revision. Nothing is half-deployed.
- Fix **forward**: write a new migration that corrects the state; never hand-edit the failed one or
  reset the DB. If the schema and `_prisma_migrations` disagree, stop and get a human — do not run
  `migrate resolve` blindly.

## Quick reference

| You are… | PRs & order |
|---|---|
| Changing only app code | 1 PR |
| Adding a secret/env/API/role the app needs | infra PR + apply → then app PR |
| Removing a secret/env/API/role | app PR → then infra PR + apply |
| Adding a table / nullable column / index | 1 PR (migration + app together) |
| Dropping/renaming/retyping a column | 3 merges: expand → backfill → contract |
| Backfilling data | separate, idempotent, deliberate script |
