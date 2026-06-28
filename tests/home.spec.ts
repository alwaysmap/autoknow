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

  test('should apply the Knox design system theme variables', async ({ page }) => {
    const bgVariable = await page.evaluate(() => {
      return window.getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    });
    const isValidValue = bgVariable === 'hsl(45, 38%, 95%)' || bgVariable === '#f7f5ed' || bgVariable.toLowerCase().replace(/\s/g, '') === 'rgb(247,245,237)';
    expect(isValidValue).toBe(true);
  });
});
