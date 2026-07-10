import { test, expect } from '@playwright/test';

test.describe('Home Page (Dashboard)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should display the main search interface', async ({ page }) => {
    // Expect a search input to be visible
    const searchInput = page.locator('input[type="search"], input[placeholder*="Search"]').first();
    await expect(searchInput).toBeVisible();
  });

  test('should display the Action Items section', async ({ page }) => {
    // Expect a heading or section indicating critical action items
    const actionHeading = page.getByRole('heading', { name: 'Action Items', exact: true });
    await expect(actionHeading).toBeVisible();
  });

  test('should display the Programs at Risk section', async ({ page }) => {
    // Expect a heading or section indicating programs at risk
    const riskHeading = page.getByRole('heading', { name: 'Programs at Risk', exact: true });
    await expect(riskHeading).toBeVisible();
  });

  test('should apply the design system theme variables', async ({ page }) => {
    const bgVariable = await page.evaluate(() => {
      return window.getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    });
    // Near-neutral off-white (hue 45 at 8% saturation) — a whisper of warmth so the
    // amber/red status colors carry. See globals.css. The CSS minifier may compile the
    // hsl() literal down to its hex equivalent.
    const normalized = bgVariable.toLowerCase().replace(/\s/g, '');
    expect(['hsl(45,8%,96%)', '#f6f5f4']).toContain(normalized);
  });
});
