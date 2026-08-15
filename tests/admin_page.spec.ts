import { test, expect } from './helpers/e2e';
import { wipeAll } from './helpers/fixtures';

test.describe('Onboarding and Seeding Controls', () => {
  // "Seed Core Data" adds reference data but NEVER wipes (src/lib/seed.ts), so the
  // "Welcome" empty state only appears against a program-less DB. This spec used to
  // depend on a prior spec leaving one clean — order-luck that held on the dev server
  // and broke the moment the suite ran against a prod build (or in isolation). Wipe
  // first so the empty state is genuinely empty, independent of what ran before.
  test.beforeAll(async () => {
    await wipeAll();
  });

  // gh-255: the copy-pasteable curl examples used to open with a literal
  // `ORIGIN=https://autoknow.alwaysmap.com`, which is wrong on every other deployment —
  // including the one the reader is looking at right now. Asserted against the SERVER'S
  // OWN origin rather than a second literal, because a test that writes the host down is
  // the same bug agreeing with itself.
  test('the curl examples name the origin the reader is actually on', async ({ page }) => {
    await page.goto('/admin');
    const origin = new URL(page.url()).origin;
    const blocks = page.locator('pre');
    await expect(blocks.first()).toContainText(`ORIGIN=${origin}`);
    await expect(page.locator('body')).not.toContainText('autoknow.alwaysmap.com');
  });

  test('should support seeding defaults only and show clean onboarding empty states', async ({ page }) => {
    // This is the only spec whose CLICKS run a whole seed: both buttons are `<form
    // action={serverAction}>`, and the second one ingests the entire mock corpus (18
    // sources) before it redirects. Playwright's 30s per-test default was never chosen for
    // that — it was simply the default, and it held while the suite had the machine to
    // itself. Now four workers share one Postgres, and a run whose median here is ~9.4s
    // (measured: 8.9/10.0/9.0/9.7) produced one excursion past 30s.
    //
    // 120s is deliberately far above the median rather than a tight fit: the tail here is
    // driven by whatever else the runner is doing, so a snug ceiling would just move the
    // false red rather than remove it, and a false red on a seed costs more than a slow
    // true one. It is a ceiling, not a target — if the median ever approaches it, that is
    // a regression in the seed and the number above is what makes it legible.
    test.setTimeout(120_000);

    await page.goto('/admin');
    await expect(page.locator('h1')).toContainText('Dev Console');

    // Seed core data only (empty state onboarding)
    await page.click('button:has-text("Seed Core Data")');
    await page.waitForURL('/ecosystem');

    // Seeding lands on the dashboard, not the landing page — you seed in order to
    // look at the ecosystem. Its onboarding box is what an empty database shows.
    await expect(page.locator('body')).toContainText('Welcome to AutoKnow');

    // Seed mock data
    await page.goto('/admin');
    await page.click('button:has-text("Seed Mock Data")');
    await page.waitForURL('/ecosystem');

    // Verify tables populated
    await expect(page.locator('body')).toContainText('Ford Evos AAOS Bring-up');
  });
});
