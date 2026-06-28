import { test, expect } from '@playwright/test';

test.describe('Offline Mode and Service Worker', () => {
  test('should display the online connectivity status indicator', async ({ page }) => {
    await page.goto('/');
    // Check that layout navigation header renders the connectivity badge
    const indicatorBadge = page.locator('span:has-text("Online")');
    await expect(indicatorBadge).toBeVisible();
  });
});
