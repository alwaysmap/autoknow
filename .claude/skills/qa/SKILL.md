---
name: qa
description: Quality gates for AutoKnow changes — linting, type checks, unit/DB/e2e tests, coverage, pre-merge verification. Load before declaring any change done.
---

# Quality assurance

## The gate

```bash
npm run evidence   # typecheck → lint → coverage → e2e → build; ALL must pass
```

Individually: `npm run lint` · `npm run typecheck` · `npm run test`
(`:watch`, `:coverage`) · `npm run test:e2e` (`:ui`). Zero lint errors AND
warnings is the bar — the suite was once left red on main and it hid real bugs.

## How the test layers work

- **Jest** (unit + DB): DB suites bind the `<name>_test` database via
  `tests/helpers/testDatabaseUrl` — the `process.env.DATABASE_URL` assignment
  must come BEFORE any import of `src/lib/db` (dynamic-import pattern used in
  every DB test; copy `tests/owner.test.ts` as the template).
- **Playwright**: boots its own dev server on :3130 with a separate
  `.next-test` build dir and stubbed auth; `workers=1` is load-bearing (specs
  serially wipe the shared `*_test` DB). Never run two suites at once.
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
