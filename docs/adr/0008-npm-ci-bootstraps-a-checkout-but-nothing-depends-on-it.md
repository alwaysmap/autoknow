---
status: accepted
date: 2026-07-21
supersedes: ""
superseded-by: ""
tags: [dev-loop, ci, docker, env]
---

# 0006. `npm ci` bootstraps a checkout — and CI and Docker never depend on that

**Context.** A fresh git worktree was not a working checkout. `.env` is gitignored
(it holds real secrets), so `git worktree add` cannot bring it, and `prisma generate`
had to be remembered separately. Worse, nothing said the file was missing:
`dotenv.config()` no-ops on an absent file and both harnesses INVENTED
`postgresql://…/autoknow` when `DATABASE_URL` was unset, so the checkout half-worked
— e2e and `npm run demo` ran green against a database nobody chose, while
`db:migrate`, Google auth and Gemini failed with errors that looked unrelated to
each other. One missing file presented as five bugs. The same `npm ci`, however,
also runs in CI and in the Dockerfile's `deps` stage, which copies only
`package*.json`, so any bootstrap it performs must vanish there.

**Decision.** `npm ci` — the one step a fresh checkout cannot skip — performs the
whole bootstrap, and three rules keep that from becoming a liability:

1. **The two halves of `postinstall` fail differently, on purpose.** Linking `.env`
   is a convenience, so it is wrapped in `|| true` and its script exits 0 on every
   path. Generating the Prisma client is correctness, so it is guarded by
   `if [ -f prisma/schema.prisma ]` — present, it runs and a real failure fails the
   install; absent (the Docker `deps` stage), it is skipped. A blanket `|| true`
   across both would ship a silently missing client.
2. **Nothing load-bearing depends on the hook.** CI runs `npm run db:generate`
   explicitly even though `postinstall` already did, because a build must not rest
   on a lifecycle side effect — `--ignore-scripts` anywhere upstream would otherwise
   surface as a confusing typecheck failure. The Dockerfile's `builder` stage runs
   it explicitly too, of necessity: it copies `node_modules` from `deps` and never
   re-runs `npm ci`. `prisma generate` is idempotent, so the duplication costs
   seconds and buys determinism.
3. **A silent fallback must announce itself.** Where an unset `DATABASE_URL` is
   still defaulted, it says so and names the command that fixes it (AGENTS lesson 5:
   degrade honestly, never fake a result). Fabricating a connection string in
   silence is what turned one fault into five.

The `deps`-stage contract — *nothing added to `postinstall` may need the source
tree* — is checked rather than trusted: CI gained an `image` job that builds the
Dockerfile on every PR.

**Alternatives rejected.**
- *A `doctor` / `bootstrap` command* — anything you must remember to run is prose,
  not enforcement; the paper cut survives with a nicer error message.
- *Copying `.env` instead of symlinking* — reproduces silent drift per worktree, the
  exact failure mode `.env.sample` had just demonstrated; a rotated secret leaves
  stale copies that fail confusingly later.
- *`npm ci --ignore-scripts` in the Docker `deps` stage* — would make the stage
  independent of `postinstall`, but skips EVERY dependency's install scripts
  (SWC, sharp), trading a small risk for a large one.
- *Copying the bootstrap script into the `deps` stage* so its no-op is deterministic
  rather than rescued by `|| true` — tried, and the build rejected it:
  `.dockerignore` excludes `scripts/` to keep the image clean. Dragging a dev-only
  script into a production image to make an already-handled error path tidier is a
  bad trade. Notably, the new `image` job is what caught this, pre-merge.
- *Letting CI rely on `postinstall` alone* — one fewer step, but it makes a required
  status check depend on an invisible hook.

**Consequences.** `postinstall` is now load-bearing for humans and agents, and
load-bearing for nothing else; that asymmetry is the whole design and must survive
edits to it. Adding anything to `postinstall` means keeping the guard shape — it has
to no-op with only `package*.json` present, and CI's `image` job will say so if it
does not. PRs pay one extra parallel job (~2–4 min alongside a much longer `quality`
job). A worktree's `.env` is a symlink, so per-worktree divergent env is no longer
possible without replacing the link — nothing needs it today, since per-worktree DB
and port isolation come from the worktree token, not from `.env`.

**Receipts.** `cc2dc64` (the link + honest fallbacks), `f56b4d2` (`.env.sample`
reconciled with the code and Terraform, `tests/envSample.test.ts` guarding it, every
`prisma` call routed through an npm script). Verified: links in a worktree,
idempotent, silent no-op in the main checkout, exit 0 with no git repo and with the
script absent, nonzero on a genuine `prisma generate` failure, and `docker build`
green locally before the `image` job was written.
