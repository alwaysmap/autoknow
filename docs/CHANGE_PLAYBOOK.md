# Change Playbook — the rules, and what enforces them

The dangerous operations here are **software-enforced** — CI gates and database
roles make them fail regardless of who attempts them. This card is the
human-readable summary; the step-by-step recipes live in the agent skills
(`db-change` for schema work, `infra-terraform` for infra ordering), and the
full original playbook is in git history.

## Enforcement inventory (what stops you, and where it lives)

| Rule | Enforced by |
|---|---|
| No DDL/`db push` from the app path | `app_runtime` DB role: row DML only, no CREATE/ALTER/DROP/TRUNCATE (`scripts/db/harden-roles.sql`; only the `app` owner role — used solely by CI `migrate deploy` — has DDL) |
| No destructive migration without review | `ci.yml` migrations-lint: new migration SQL with DROP/TRUNCATE/retype/NOT-NULL fails without a `-- allow-destructive: <reason>` line |
| No mixed infra+app PRs | `ci.yml` change-ordering: touching `infra/terraform/**` and app code in one PR fails without `allow-mixed-infra: <reason>` in a commit message |
| Forward-only prod migrations | `deploy.yml` runs only `prisma migrate deploy`; a failed migration blocks the rollout (`needs: migrate`) — prod keeps serving the old revision |
| Immutable migration history | Prisma checksums: editing an applied migration fails `migrate deploy` |
| No accidental wipes | `DESTRUCTIVE_DB_ALLOWED` guard: destructive ops refuse any non-`*_test` DB not named exactly |
| Last resort | Cloud SQL automated backups + PITR, always on |
| Behavioral drift | `ci.yml` quality gate: typecheck, lint, jest, e2e, prod build on every PR |

## Golden rules (the why behind the gates)

1. **`prisma db push` is local-throwaway-only** — it reconciles by *dropping*;
   prod is forward-only `prisma migrate deploy`.
2. **Applied migrations are immutable history** — fix forward, never edit.
3. **Additive schema changes ship with app code in one PR; destructive ones
   split expand → backfill → contract across separate merges** — the old
   revision keeps serving during every rollout window and must stay compatible.
4. **Infra before app for additions; app before infra for removals** — app
   deploys are automatic on merge, `terraform apply` is human-run, so a
   combined PR deploys code whose infra doesn't exist yet.
5. **Features gate on env presence** (`fooConfigured = !!process.env.FOO`) and
   degrade honestly — that's what makes rule 4's ordering safe.

## Quick reference

| You are… | PRs & order | Detail |
|---|---|---|
| Changing only app code | 1 PR → auto-deploy | — |
| Adding a secret/env/API/role | infra PR + human apply → app PR | `infra-terraform` skill |
| Removing a secret/env/API/role | app PR → infra PR + apply | `infra-terraform` skill |
| Adding a table / nullable column / index | 1 PR (migration + app) | `db-change` skill |
| Dropping/renaming/retyping a column | 3 merges: expand → backfill → contract | `db-change` skill |
| Backfilling data | separate idempotent script, never inside `migrate deploy` | `db-change` skill |
| Migration failed in CI | rollout is blocked; fix forward; if `_prisma_migrations` disagrees with the schema, stop and get a human | `db-change` skill |
