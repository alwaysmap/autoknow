# npm scripts do everything

Every dev, test, database, and CI task is an `npm run` script — the catalog
(with a system-architecture diagram) is in [README.md](README.md). Use the
scripts; do not invoke `next`/`jest`/`playwright`/`prisma` or `scripts/**`
directly. The GitHub workflows go through the same scripts (`ci:*`). Quick core:
`dev` · `lint` · `typecheck` · `test` · `test:e2e` · `evidence` (the full gate)
· `db:up` / `db:migrate` / `db:push` (local only) / `db:studio`.

# Task skills — load context per task, not per session

Don't bulk-read the docs. Invoke the matching project skill; each one carries
the distilled rules and points at the exact doc sections that matter:

| Skill | Invoke when… |
|---|---|
| `ui-design` | building/changing any UI, UX, styling, or user-facing copy |
| `db-change` | touching `prisma/schema.prisma`, migrations, seeds, backfills |
| `infra-terraform` | touching `infra/terraform/**`, secrets, env vars, domains |
| `gcp-debug` | checking/debugging the live deployment: deploys, logs, cron, Chat |
| `qa` | running quality gates; before declaring any change done |

Deep docs live in `docs/` (OPERATIONS, CHANGE_PLAYBOOK, DEPLOYMENT_GCP,
design.md, plan docs). Read the specific section a skill points you at, not the
whole file.

# Safety non-negotiables (always in force)

- **Never `prisma db push`, `migrate reset`, or edit an applied migration
  against a shared/prod DB.** Prod is forward-only `prisma migrate deploy`.
- **Destructive schema changes** split expand → backfill → contract across
  separate merges; additive ones may ship with app code in one PR.
- **Infra ordering:** add = infra PR + human `terraform apply` FIRST, app PR
  second (config-gated). Remove = app PR first. `terraform apply` is human-run;
  app deploys are automatic on merge to `main`.
- Full rules + recipes: [docs/CHANGE_PLAYBOOK.md](docs/CHANGE_PLAYBOOK.md)
  (mandatory read before any schema/infra/secret change — the `db-change` and
  `infra-terraform` skills say when).

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Compounding lessons — each cost a real incident here

One-liners; receipts and commands live in the task skills. Extend this list when
you earn a new one.

1. A green pipeline is not a deploy — verify `/api/health` `.sha` against
   `origin/main`, never the Actions UI (`gcp-debug`).
2. Enforce rules in software, not prose: a new dangerous operation ships its
   fail-closed guard in the same PR (wipe guard, DDL-less runtime role,
   migration lint are the precedents).
3. Entity references are pickers + canonical keys, never free text; reject
   non-matches at the mutation boundary (`resolvePerson` pattern).
4. A new machine endpoint needs BOTH a session-gate exemption in `src/proxy.ts`
   and its own credential — one without the other is broken or exposed.
5. Gate features on env presence; degrade with an honest message — never a
   crash, endless spinner, or faked result.
6. Google-side config is sticky and propagates for up to 24h; get ground truth
   from Google's logs, not yours (`gcp-debug`).
7. After fixing a defect, grep for its siblings before closing — the same bug
   usually exists in a second file, in a different disguise.
8. Browser-only state reads use `useSyncExternalStore` with a neutral server
   snapshot; first e2e interactions get hydration-guarded retries (`ui-design`, `qa`).
9. The `*_test` database is shared and wiped per spec: one suite at a time,
   and never point a server or demo at it (`db-change`, `qa`).
10. Docs state their status or they lie — the PR that implements or retires
    what a doc describes updates that doc's STATUS line.
11. Commit messages carry diagnosis + evidence ("heap-profiled, ~10MB/s"), not
    just the change — they are the institutional memory these lessons were
    mined from.
12. Red-team plans before building them; the review's job is to DELETE
    mechanisms, not add them.
