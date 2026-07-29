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

import { test as base, expect, type Locator, type Page } from '@playwright/test';
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

/**
 * A phase card on the PhaseTrack rail: `expandCard` TOGGLES its size, `openCard`
 * and `closeCard` each ensure a STATE (open, closed). THE CARD IS THE CONTROL —
 * rows default collapsed and there is no chevron, so a click anywhere on the card
 * sizes it (and selects and traces it); the title is the stable, keyboard-reachable
 * part, so tests drive it there. Three helpers because the click is a toggle and
 * most call sites want a STATE, not a toggle: opening the popover opens the card on
 * the way (min is one line, so the zoom button is not there yet) and a later blind
 * toggle would close it again; asserting a card folds back closed needs the inverse,
 * retried against its own state rather than a bare click (autoknow-9at: a webkit run
 * under full-suite load missed the click outright, and an assertion on vanished text
 * downstream had nothing to retry against but a card that was never actually
 * collapsed).
 *
 * They live here rather than in one spec because a third spec wanted them and reached
 * for `[class*="body"]` to read the open state — a hashed-class substring, which
 * starts matching the day someone adds another class with `body` in its name
 * (docs/knowledge/global-class-substring-selector-catches-module-classes.md). The
 * title carries `aria-expanded` precisely so nobody has to guess.
 */
export const expandCard = (rowLocator: Locator) => rowLocator.locator('a[data-card-title]').click();

export const openCard = async (rowLocator: Locator) => {
  const title = rowLocator.locator('a[data-card-title]');
  if ((await title.getAttribute('aria-expanded')) !== 'true') await title.click();
};

export const closeCard = async (rowLocator: Locator) => {
  const title = rowLocator.locator('a[data-card-title]');
  await expect(async () => {
    if ((await title.getAttribute('aria-expanded')) !== 'false') await title.click();
    await expect(title).toHaveAttribute('aria-expanded', 'false');
  }).toPass({ timeout: 20000 });
};

/**
 * Open a phase's PROGRESS view — recording an update and the full hill log, which is
 * one affordance because an update IS an entry in that log (autoknow-crw.3). It is the
 * only thing the card still opens over itself; everything the retired DETAILS popover
 * carried besides this is on the card or in the phase editor.
 *
 * The card's three affordances only exist at STANDARD size — min is one line — so the
 * card is opened on the way, and `openCard` is used rather than a bare toggle so a
 * caller that already opened it does not get it shut again.
 *
 * Hydration-resilient, in the shape a first interaction after a page load requires
 * (AGENTS lesson 8): only act while the view is closed, because a late-opening overlay
 * scrims the link and a blind retry-click would hang on it.
 */
export const openProgressView = async (page: Page, rowLocator: Locator): Promise<void> => {
  const view = page.getByTestId('phase-progress');
  await expect(async () => {
    if (!(await view.isVisible())) {
      const link = rowLocator.getByTestId('phase-progress-link');
      if (!(await link.isVisible())) await openCard(rowLocator);
      await link.click({ timeout: 2000 });
    }
    await expect(view).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 20000 });
};

/**
 * Open `trigger`'s menu and wait for `item` inside it, in the hydration-guarded shape a
 * first interaction after a page load requires (AGENTS lesson 8): re-open only when the
 * item is not already showing, never a bare click. Lives here rather than hand-rolled per
 * file (autoknow-8g1) — every spec that opens an anchored menu and asserts on an item
 * inside it needs the same shape.
 */
export async function openMenu(trigger: Locator, item: Locator): Promise<void> {
  await expect(async () => {
    if (!(await item.isVisible())) await trigger.click({ timeout: 2000 });
    await expect(item).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20000 });
}

/**
 * `openMenu` plus the click that usually follows it: open `trigger`'s menu and
 * click `item`. Lives here for the same reason `openMenu` does (autoknow-8g1) —
 * admin_operations.spec.ts had this exact composition three times (once as a
 * module-scope helper, twice more as local closures inside individual tests).
 */
export async function clickMenuItem(trigger: Locator, item: Locator): Promise<void> {
  await openMenu(trigger, item);
  await item.click();
}

/**
 * Open `trigger`'s menu, click `item`, and wait for the `dialog` it opens — retried
 * as ONE unit, not `openMenu` followed by a separate assertion (autoknow-92u): a
 * kebab item whose click opens a dialog needs the WHOLE chain retried together, since
 * a menu that closed before the dialog appeared needs re-opening, not a re-click on a
 * control that may no longer be there.
 */
export async function openMenuItemDialog(trigger: Locator, item: Locator, dialog: Locator): Promise<void> {
  await expect(async () => {
    if (!(await dialog.isVisible())) {
      if (!(await item.isVisible())) await trigger.click({ timeout: 2000 });
      await item.click({ timeout: 2000 });
    }
    await expect(dialog).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 20000 });
}
