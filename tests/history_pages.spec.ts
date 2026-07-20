import { test, expect } from '@playwright/test';
import { prisma } from './helpers/db';
import { seedProgram, type SeededProgram } from './helpers/fixtures';

// Behavioral coverage for the status-update LOG pages: a list of updates (needle for
// programs/partners, hill for phases), newest first — no chart, and a back affordance
// that returns wherever the user actually came from.

test.describe('History pages', () => {
  test.describe.configure({ mode: 'serial' });

  let seeded: SeededProgram;

  test.beforeAll(async () => {
    seeded = await seedProgram();
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test('program history is a status-update log with an honest back', async ({ page }) => {
    // Arrive FROM the home page — back must return there, not to a hardcoded guess.
    await page.goto('/');
    await page.goto(`/history/project/${seeded.projectId}`);

    await expect(page.locator('h1')).toContainText('R2 AAOS Bring-up');
    await expect(page.getByText('Every needle status update, newest first.')).toBeVisible();
    // No chart — this page is a log, the gauges live on the program page.
    await expect(page.locator('section svg')).toHaveCount(0);

    // The weekly update renders as a list-card: health word + markdown note.
    const changes = page.locator('article').filter({ hasText: 'Concerned' });
    await expect(changes.first()).toContainText('Codec blockers slowing integration.');

    await page.getByRole('button', { name: '← Back' }).click();
    await page.waitForURL((u) => u.pathname === '/');
  });

});
