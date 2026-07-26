// The `test` every spec imports, instead of `@playwright/test` directly. Its one job is to
// point each worker at ITS OWN web server — the per-worker lane is explained once, in
// tests/helpers/worktree.ts.
//
// Why a fixture and not `use.baseURL` in the config: the config is evaluated once, in the
// main process, where there is no worker to ask. `baseURL` is a test-scoped OPTION, so a
// fixture of the same name overrides it per test — and a fixture is the only place
// `testInfo.parallelIndex` exists.
//
// Importing `test` from '@playwright/test' in a spec is therefore a bug, and a quiet one:
// the config leaves `baseURL` unset on purpose, so the spec gets no base at all while its
// DATABASE stays correct (that comes from the process env, not from this import). The
// worker then seeds fixtures it cannot reach. tests/e2eWorkerIsolation.test.ts fails on the
// import rather than leaving it to review.

import { test as base } from '@playwright/test';
import { testServerPort } from './worktree';

export const test = base.extend({
  // Playwright calls this second argument `use`; it is named `provide` here because
  // eslint's react-hooks/rules-of-hooks reads a bare `use(...)` as React's `use` and
  // rejects the file. The name is ours to choose — the position is what Playwright binds.
  baseURL: async ({}, provide, testInfo) => {
    await provide(`http://localhost:${testServerPort(testInfo.parallelIndex)}`);
  },
});

export { expect, type Page, type Locator } from '@playwright/test';
