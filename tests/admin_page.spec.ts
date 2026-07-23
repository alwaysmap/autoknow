import { test, expect } from '@playwright/test';
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

  test('should support seeding defaults only and show clean onboarding empty states', async ({ page }) => {
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
