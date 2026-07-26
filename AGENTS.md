# npm scripts do everything

Every dev, test, database, and CI task is an `npm run` script — the catalog
(with a system-architecture diagram) is in [README.md](README.md). Use the
scripts; do not invoke `next`/`jest`/`playwright`/`prisma` or `scripts/**`
directly. The GitHub workflows go through the same scripts (`ci:*`). Quick core:
`dev` · `demo` (one-command seeded demo server, below) · `lint` · `typecheck` ·
`test` · `test:e2e` · `evidence` (the full gate) · `db:up` / `db:migrate` /
`db:push` (local only) / `db:studio` · `db:test:clean` (drop stray test DBs).

**Want the app running with realistic data?** `npm run demo` — one command:
a per-worktree `autoknow_<token>_demo` database, schema synced, `next dev` with a
stub signed-in identity, and mock data seeded through the app's own API routes.
Idempotent (`--reseed` to refresh). This is the scripted replacement for the old
manual "scratch DB + seed via /admin" recipe. (Agents that can't hold a foreground
server use the `preview_start` path in the `ui-design` skill instead.)

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
| `compound` | **before merging** any PR touching `src/**` or `prisma/**`, and after an incident or real decision — record it (decisions → `docs/adr/`, findings → `docs/knowledge/`, always-on rules → here). CI blocks the merge until you declare |

Deep docs live in `docs/` (OPERATIONS, CHANGE_PLAYBOOK, DEPLOYMENT_GCP,
design.md, plan docs). Read the specific section a skill points you at, not the
whole file.

**Compounded knowledge has three homes, and you reach for them at different
moments.** The lessons below are always in context because they always apply.
The other two are not, and are meant to be looked up:

* [docs/adr/](docs/adr/README.md) — **decisions.** Check before relitigating a
  settled question.
* [docs/knowledge/](docs/knowledge/README.md) — **findings**: how this system
  actually behaves, learned the hard way. Scan the index's trigger column when
  PLANNING a change (does a row cover what you're about to touch?) and when
  STUCK on a surprise (`grep -A4 '^symptoms:' docs/knowledge/*.md`). Never
  bulk-read it — a note that has to be found by reading all of them is a note
  whose index row is too vague.

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

An index of dangers, not a store of detail: each line flags the trap and names
where the detail lives. Numbers are cited from code and records, so rewrite text
freely but **never renumber** (`tests/agentsLessons.test.ts` enforces it). A line
here taxes every future session, so the `compound` skill sets the bar for adding
one and routes most findings to [docs/knowledge/](docs/knowledge/README.md).

1. A green pipeline is not a deploy — ask prod what sha it is running, and know
   when a merge correctly deploys nothing (`gcp-debug`).
2. Enforce rules in software, not prose: a new dangerous operation ships its
   fail-closed guard in the same PR (wipe guard, DDL-less runtime role,
   migration lint are the precedents).
3. Entity references are pickers + canonical keys, never free text; reject
   non-matches at the mutation boundary (`ui-design`).
4. A machine-called endpoint needs a session-gate exemption AND its own
   credential — one without the other is broken or exposed
   ([note](docs/knowledge/machine-endpoint-needs-exemption-and-credential.md)).
5. Gate features on env presence; degrade with an honest message — never a
   crash, endless spinner, or faked result (`infra-terraform`).
6. Google-side config is sticky and slow to propagate; get ground truth from
   Google's logs, not yours (`gcp-debug`).
7. Fix the PATTERN, not the instance — the same bug usually exists in a second
   file, in a different disguise, and the same control usually exists in three
   hand-rolled variants. Sweep before closing, and name the sweep in the issue so
   nobody has to remember it later (`.github/ISSUE_TEMPLATE`).
8. Browser-only state reads and first e2e interactions each have ONE required
   pattern; using anything else is the top flake source (`ui-design`, `qa`).
9. The `*_test` database and the e2e port are per-worktree, but within a
   worktree there is still only one of each: run one suite at a time, and never
   point a server or demo at them (`db-change`, `qa`).
10. Docs state their status or they lie — the PR that implements or retires
    what a doc describes updates that doc's STATUS line.
11. Commit messages carry diagnosis + evidence ("heap-profiled, ~10MB/s"), not
    just the change — they are the institutional memory these lessons were
    mined from.
12. Red-team plans before building them; the review's job is to DELETE
    mechanisms, not add them.
13. "Who am I" comes from the session, never a literal — seed data binds its
    "me" persona to `getCurrentUser()`, and resolution uses `CurrentUser.email`
    (`.display` is lossy: deriving an address from it rewrites the domain and
    lands on a different person). [ADR: The signed-in session is the only source of "who I am"](docs/adr/2026-07-21-session-is-the-only-source-of-who-i-am.md).
14. Third-party assets are proxied through our own origin, never linked — the CSP
    `img-src` stays `'self'` and the host allowlist becomes the security boundary
    ([ADR: Third-party images are proxied through our origin; `img-src` stays `'self'`](docs/adr/2026-07-21-proxy-third-party-images-keep-csp-self.md)).
15. A URL here is DATA, not just code — AI-brief citations persist hrefs — so
    retiring one means migrating the rows that cite it, not only grepping
    `src/**` ([ADR: Retiring a URL deletes the route and migrates the data that cites it](docs/adr/2026-07-21-retiring-a-url-migrates-the-data-that-cites-it.md)).
16. `npm ci` bootstraps a checkout (links `.env`, generates the Prisma client) —
    so CI and Docker must NOT depend on that hook, and nothing added to it may
    need the source tree ([ADR: `npm ci` bootstraps a checkout — and CI and Docker never depend on that](docs/adr/2026-07-21-npm-ci-bootstraps-a-checkout-but-nothing-depends-on-it.md)).
17. A diagram answers "what does this touch", not "what could this ever reach" —
    transitive closure lights ~everything and says nothing ([ADR: A trace paints direct neighbours; the closure only fades cards](docs/adr/2026-07-21-a-trace-paints-direct-neighbours-not-the-closure.md)).
18. Ink that MEANS something derives its direction, extent and contrast from the
    data — never from the path, constant or predicate beneath it — and is signed
    off from a SCREENSHOT: counting elements proves existence, not visibility
    ([ADR: A semantic overlay derives from the data it means, never from the layer beneath](docs/adr/2026-07-21-semantic-overlays-derive-from-data-not-from-the-layer-beneath.md)).

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:970c3bf2 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   bd dolt push
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->

<!-- BEGIN BEADS CODEX SETUP: generated by bd setup codex -->
## Beads Issue Tracker

Use Beads (`bd`) for durable task tracking in repositories that include it. Use the `beads` skill at `.agents/skills/beads/SKILL.md` (project install) or `~/.agents/skills/beads/SKILL.md` (global install) for Beads workflow guidance, then use the `bd` CLI for issue operations.

### Quick Reference

```bash
bd ready                # Find available work
bd show <id>            # View issue details
bd update <id> --claim  # Claim work
bd close <id>           # Complete work
bd prime                # Refresh Beads context
```

### Rules

- Use `bd` for all task tracking; do not create markdown TODO lists.
- Run `bd prime` when Beads context is missing or stale. Codex 0.129.0+ can load Beads context automatically through native hooks; use `/hooks` to inspect or toggle them.
- Keep persistent project memory in Beads via `bd remember`; do not create ad hoc memory files.

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.
<!-- END BEADS CODEX SETUP -->
