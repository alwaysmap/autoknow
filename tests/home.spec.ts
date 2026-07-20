import { test, expect } from '@playwright/test';

// One smoke test: the home dashboard boots and shows its leadership surface.
// Static-content assertions beyond this belong in unit tests or design review —
// e2e minutes are for user/system interaction flows.
test.describe('Home Page (Dashboard)', () => {
  test('renders the leadership dashboard (smoke)', async ({ page }) => {
    await page.goto('/');
    const searchInput = page.locator('input[type="search"], input[placeholder*="Search"]').first();
    await expect(searchInput).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Programs at Risk', exact: true })).toBeVisible();
  });
});
