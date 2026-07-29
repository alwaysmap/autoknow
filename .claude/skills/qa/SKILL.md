---
name: qa
description: Quality gates for AutoKnow changes — linting, type checks, unit/DB/e2e tests, coverage, pre-merge verification. Load before declaring any change done.
---

# Quality assurance

## The gate

```bash
npm run evidence   # typecheck → lint → coverage → e2e → build; ALL must pass
```

CI runs the same gate on every PR (`ci.yml` `quality` job: typecheck, lint,
jest, e2e, prod build against a pgvector service container) — but run
`evidence` locally first; a red PR check is a slower feedback loop, not a
substitute for one.

**A rebase invalidates the green run** — the new base is a different program, so
the default is the full gate again. Narrow it to `typecheck` + `lint` + the repo gate scripts
(`ci:lint-migrations`, `ci:lint-ordering`, `ci:lint-compound`), leaving CI's full
suite as the backstop, ONLY when all four hold:

1. conflict resolution touched only non-executing files (`docs/**`,
   `.claude/skills/**`);
2. the rebased diff against the NEW base — restricted to `src/**`, `prisma/**`,
   `tests/**`, `package.json` and config — is BYTE-IDENTICAL to the pre-rebase
   diff against the OLD base. Prove it (`git diff <old-base>...<old-head>` vs
   `git diff <new-base>...HEAD` over those paths); do not assume it;
3. the PR rests on no whole-tree claim — no sweep receipt, no "all N call sites",
   no lint guard asserted to cover every site;
4. the files the new base changed do not intersect the files this PR touches.

Any one failing means the full gate, and a rebase carrying a migration re-verifies
forward-only from `0_init` regardless. Condition 3 is the one that bites: PR #207
added a `scrollIntoView` that did not exist at #208's branch point, falsifying
#208's "appears in `src/` exactly twice" receipt while #208's own diff never
changed. A moving base can falsify a claim about the whole tree without touching
a line of your diff.

Individually: `npm run lint` · `npm run typecheck` · `npm run test`
(`:watch`, `:coverage`) · `npm run test:e2e` (`:ui`). Zero lint errors AND
warnings is the bar — the suite was once left red on main and it hid real bugs.

## How the test layers work

- **Jest** (unit + DB): DB suites bind their worker's `<name>_<worktree>_j<n>_test`
  database via `tests/helpers/testDatabaseUrl` — called with no argument, it
  resolves the caller's own lane, so a suite needs no per-file wiring. The
  `process.env.DATABASE_URL` assignment must come BEFORE any import of
  `src/lib/db` (dynamic-import pattern used in every DB test; copy
  `tests/owner.test.ts` as the template).
- **Per-worktree isolation**: the `*_test` DB name and the Playwright port both
  carry a token derived from the checkout (`tests/helpers/worktree`), so
  concurrent worktrees get separate DBs/ports and can't clobber each other
  (AGENTS lesson 9). Override with `WORKTREE_ID` / `TEST_SERVER_PORT` /
  `TEST_DATABASE_URL` (e.g. to pin a name in CI). Test DBs are created lazily by
  the global setups and **never auto-dropped**, so a worktree leaves one
  `…_w<n>_test` per e2e worker and one `…_j<n>_test` per jest worker behind — run
  **`npm run db:test:clean`** to drop every idle `autoknow…_test` DB (it skips
  any with open connections, and never touches the real `autoknow` DB or the
  demo/scratch DBs, which lack the `_test` suffix).
- **Per-worker isolation**: BOTH runners give every worker its own database,
  because both wipe what they are given. The lanes are named apart — `_w<n>` for
  Playwright, `_j<n>` for jest — so the two suites can run at the same time;
  `tests/testDatabaseUrl.test.ts` asserts the two sets never intersect.
  - *jest*: `maxWorkers` (jest.config, `JEST_WORKERS` overrides, 4 by default);
    `tests/global-setup` provisions one database per worker by reading that
    resolved count back off jest's own globalConfig, so the two cannot drift.
  - *e2e*: `e2eWorkers()` workers — 4 by default, `E2E_WORKERS` overrides — each
    owning a `…_w<n>_test` database AND its own `next start` on `basePort + n`.
    Three things must agree (worker count, port, DB name) and all three fail
    silently, so `tests/e2eWorkerIsolation.test.ts` asserts them. **A spec must
    import `test` from `tests/helpers/e2e`, never from `@playwright/test`** — the
    per-worker `baseURL` lives in that fixture, and the guard fails the build.
- **Playwright**: serves a PROD build out of `.next-test` with stubbed auth. The
  build runs ONCE, in the `test:e2e*` npm scripts, before Playwright starts — the
  `webServer` entries only `next start`, so run e2e through the scripts, not
  `npx playwright test`. Parallelism stops at the FILE boundary
  (`fullyParallel: false`): tests within a file share one wipe. Never run two
  suites at once *within the same worktree* (different worktrees are safe).
- **Browser matrix is deliberate — don't widen it casually**: chromium runs the
  full suite; webkit runs only the engine-sensitive specs (dialogs,
  month/range inputs, SVG drag: `projects_flow`, `project_details`,
  `phase_graph`, `needle`). Firefox was dropped and the screenshot generator is
  opt-in (`npm run test:e2e:screens`) — e2e minutes are the most expensive
  test minutes; a new spec joins the webkit list only if it exercises
  engine-divergent behavior.
- **e2e flake rule**: the first interaction after a page load is a
  hydration-guarded retry (`expect(async () => {...}).toPass()` — see
  `tests/project_details.spec.ts`). An unguarded first click is the #1 flake.
  **If that click NAVIGATES, the guard is `clickUntilNavigated` (tests/helpers/e2e.ts),
  never a bare `toPass`**: a retry body that leaves the page is not idempotent,
  and a navigation that lands late strands the loop on the destination
  ([note](../../../docs/knowledge/a-retry-loop-that-navigates-strands-itself-on-the-destination.md)).
  A guarded click can also be swallowed outright when the page scrolls between
  its press and its release
  ([note](../../../docs/knowledge/a-page-scroll-between-press-and-release-loses-the-click.md)).
  And a spec that STAGES that race itself must wait for the guard to arm before
  pressing, on a signal the server cannot render — otherwise it tests an unguarded
  page and fails wearing the bug's own signature
  ([note](../../../docs/knowledge/a-test-that-starts-page-motion-before-the-press-races-its-own-press-point.md)).

## Discipline

- **A green e2e check is not evidence a flake is fixed.** `retries: 1` reports a
  spec that failed then passed as flaky, and the check goes green. State the
  criterion before you look and take it from the LOG — no `Retry #1`, plus the
  invariant the fix establishes
  ([note](../../../docs/knowledge/a-test-that-passes-on-retry-reports-the-check-green.md)).
- TDD: new behavior gets a failing test first; bug fixes start with a test
  reproducing the bug. Test expectations (black-box), not implementation.
- Coverage bar: **80%+ statements/lines**, proven by `npm run test:coverage`
  output — not asserted from memory.
- UI changes additionally get verified in the running app (`npm run dev` /
  preview): computed styles, both themes — tests don't catch visual drift.
- When a fix lands, grep for sibling instances of the same defect pattern
  before closing (the checkbox-label bug existed twice in two files).
- Prod verification after merge belongs to the **gcp-debug** skill
  (`/api/health` sha check).

**Findings for this surface:** [docs/knowledge/](../../../docs/knowledge/README.md) —
scan the trigger column for `mutation-testing a new guard` before planting a mutation,
and when a restored baseline is still red.
