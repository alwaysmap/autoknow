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

# Close the loop in a real browser — freely

You have a Chrome browser instance; treat it as a first-class dev tool, not a
last resort. Changed UI? Load the page and look (both themes). Debugging prod?
Open the console URLs from `gcp-debug`. Testing Chat? Drive chat.google.com.
Verifying a form? Fill and submit it. Seeing beats inferring — several bugs in
this repo's history survived green tests and died on first real page load.

**Google-identity rule (multi-login gotcha):** every Google property must be
loaded as **the `alwaysmap.com` Workspace identity** (`dylan@alwaysmap.com`) —
it owns the GCP project, the Workspace admin console, and satisfies the app's
domain gate. Google defaults multi-login sessions to the wrong account, and the
failure mode is silent: "project not found", empty resource lists, or a
consumer-flavored UI. So, in every case:

- Force the account in the URL: append `authuser=dylan@alwaysmap.com` to any
  `console.cloud.google.com` / `admin.google.com` / `aistudio.google.com` URL
  (e.g. `…/run/detail/us-central1/autoknow/logs?project=autoknow-prod-1895f1&authuser=dylan@alwaysmap.com`);
  Gmail/Chat/Drive/Calendar take the path form `…/u/dylan@alwaysmap.com/`.
- **Verify the active avatar (top-right) before trusting anything on the page.**
  A missing project or space almost always means wrong account, not missing
  resource — switch accounts before concluding anything.
- The app itself (`https://autoknow.alwaysmap.com`) only admits
  `alwaysmap.com` accounts (`AUTH_ALLOWED_DOMAIN`).

# Safety non-negotiables (always in force)

- **Never `prisma db push`, `migrate reset`, or edit an applied migration
  against a shared/prod DB.** Prod is forward-only `prisma migrate deploy`.
- **Destructive schema changes** split expand → backfill → contract across
  separate merges; additive ones may ship with app code in one PR.
- **Infra ordering:** add = infra PR + human `terraform apply` FIRST, app PR
  second (config-gated). Remove = app PR first. `terraform apply` is human-run;
  app deploys are automatic on merge to `main`.
- These rules are CI/DB-enforced; the enforcement inventory + quick-reference
  card is [docs/CHANGE_PLAYBOOK.md](docs/CHANGE_PLAYBOOK.md), and the
  step-by-step recipes live in the `db-change` and `infra-terraform` skills.

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
