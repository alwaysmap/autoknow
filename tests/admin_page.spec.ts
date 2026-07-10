import { test, expect } from '@playwright/test';

test.describe('Onboarding and Seeding Controls', () => {
  test('should support seeding defaults only and show clean onboarding empty states', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.locator('h1')).toContainText('Dev Console');

    // Seed core data only (empty state onboarding)
    await page.click('button:has-text("Seed Core Data")');
    await page.waitForURL('/');

    // Verify onboarding boxes are visible
    await expect(page.locator('body')).toContainText('Welcome to AutoKnow');
    await expect(page.locator('body')).toContainText('No pending action items detected. Clear skies!');

    // Seed mock data
    await page.goto('/admin');
    await page.click('button:has-text("Seed Mock Data")');
    await page.waitForURL('/');

    // Verify tables populated
    await expect(page.locator('body')).toContainText('Ford Evos AAOS Bring-up');
  });
});
