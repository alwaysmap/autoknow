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

Individually: `npm run lint` · `npm run typecheck` · `npm run test`
(`:watch`, `:coverage`) · `npm run test:e2e` (`:ui`). Zero lint errors AND
warnings is the bar — the suite was once left red on main and it hid real bugs.

## How the test layers work

- **Jest** (unit + DB): DB suites bind the `<name>_<worktree>_test` database via
  `tests/helpers/testDatabaseUrl` — the `process.env.DATABASE_URL` assignment
  must come BEFORE any import of `src/lib/db` (dynamic-import pattern used in
  every DB test; copy `tests/owner.test.ts` as the template).
- **Per-worktree isolation**: the `*_test` DB name and the Playwright port both
  carry a token derived from the checkout (`tests/helpers/worktree`), so
  concurrent worktrees get separate DBs/ports and can't clobber each other
  (AGENTS lesson 9). Override with `WORKTREE_ID` / `TEST_SERVER_PORT` /
  `TEST_DATABASE_URL` (e.g. to pin a name in CI).
- **Playwright**: boots its own dev server on the per-worktree port (~3130) with a
  separate `.next-test` build dir and stubbed auth; `workers=1` is load-bearing
  (specs serially wipe this worktree's `*_test` DB). Never run two suites at once
  *within the same worktree* (different worktrees are now safe to run in parallel).
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

## Discipline

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
