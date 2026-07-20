import { test, expect } from '@playwright/test';
import { prisma } from './helpers/db';
import { seedProgram, type SeededProgram } from './helpers/fixtures';

// Behavioral coverage for the unified activity feed: heterogeneous update kinds render
// as list cards (mini needle / mini hill / context), category chips filter them, and
// items are attributed to their program everywhere except the program's own page.

test.describe('Activity feed', () => {
  test.describe.configure({ mode: 'serial' });

  let seeded: SeededProgram;

  test.beforeAll(async () => {
    seeded = await seedProgram();
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test('activity mixes kinds and filters by category chips', async ({ page }) => {
    // The ecosystem page no longer carries a feed — the partner page is the
    // canonical activity surface (items still name their program there).
    await page.goto(`/partners/${seeded.oemId}`);

    // All three seeded kinds are present under "All".
    await expect(page.getByText('Weekly update: Concerned')).toBeVisible();
    await expect(page.getByText('Codec delivery plan')).toBeVisible();
    // Items name their program at ecosystem scope.
    await expect(page.getByText('R2 AAOS Bring-up').first()).toBeVisible();

    // Filter to Context: the doc stays, the needle update goes. Retry the chip click —
    // on a cold load it can land before hydration attaches the handler.
    await expect(async () => {
      await page.locator('button[class*="ActivityFeed"]').filter({ hasText: 'Context' }).click();
      await expect(page.getByText('Weekly update: Concerned')).toHaveCount(0, { timeout: 1500 });
    }).toPass({ timeout: 15000 });
    await expect(page.getByText('Codec delivery plan')).toBeVisible();

    // Filter to Progress (needle changes): the reverse.
    await page.locator('button[class*="ActivityFeed"]').filter({ hasText: 'Progress' }).click();
    await expect(page.getByText('Weekly update: Concerned')).toBeVisible();
    await expect(page.getByText('Codec delivery plan')).toHaveCount(0);

    // Filter to Phases (hill updates): phase state cards appear (title carries derived status).
    await page.locator('button[class*="ActivityFeed"]').filter({ hasText: 'Phases' }).click();
    await expect(page.getByRole('link', { name: 'Integration: In Progress' })).toBeVisible();
    await expect(page.getByText('Weekly update: Concerned')).toHaveCount(0);
  });


  test('partner-scoped activity attributes items to their program', async ({ page }) => {
    await page.goto(`/partners/${seeded.oemId}`);

    // The weekly update names the program it belongs to (a partner spans many programs).
    const item = page.locator('article').filter({ hasText: 'Weekly update: Concerned' });
    await expect(item).toContainText('R2 AAOS Bring-up');
  });
});
