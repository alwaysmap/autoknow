// The `test` every spec imports, instead of `@playwright/test` directly. Its one job is to
// point each worker at ITS OWN web server — the per-worker lane is explained once, in
// tests/helpers/worktree.ts. `clickUntilNavigated`, at the bottom, rides along because it
// is the other thing a spec must not hand-roll.
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

import { test as base, expect, type Page } from '@playwright/test';
import { testServerPort } from './worktree';

export { expect, type Page, type Locator } from '@playwright/test';

export const test = base.extend({
  // Playwright calls this second argument `use`; it is named `provide` here because
  // eslint's react-hooks/rules-of-hooks reads a bare `use(...)` as React's `use` and
  // rejects the file. The name is ours to choose — the position is what Playwright binds.
  baseURL: async ({}, provide, testInfo) => {
    await provide(`http://localhost:${testServerPort(testInfo.parallelIndex)}`);
  },
});

/**
 * The hydration-guarded first interaction, for a click that NAVIGATES AWAY.
 *
 * The plain `expect(async () => …).toPass()` guard retries the interaction until it
 * takes, which is right while the retry leaves the page where it found it. A click
 * that navigates does not: once the navigation lands — even LATE, after this attempt's
 * own budget gave up on it — the job is done, and re-running the body starts over on
 * the destination page, where the control it clicks does not exist. Every remaining
 * attempt then burns its whole click timeout waiting for a missing element, and the
 * outer budget dies reporting the wrong thing entirely: "timeout waiting for
 * getByTestId('kebab-menu')" on a page that correctly has no kebab (autoknow-i8q,
 * webkit under full-suite load, where a slow route is all it takes).
 *
 * So the arrival is checked FIRST and the body is skipped once it has happened. `open`
 * must leave the page on `url` and is called only while it has not.
 */
export async function clickUntilNavigated(page: Page, url: RegExp, open: () => Promise<void>) {
  await expect(async () => {
    if (url.test(page.url())) return;
    await open();
    await page.waitForURL(url, { timeout: 1500 });
  }).toPass({ timeout: 20000 });
}
