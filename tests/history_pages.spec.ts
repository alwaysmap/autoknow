import { test, expect } from '@playwright/test';
import { prisma } from './helpers/db';
import { seedProgram, type SeededProgram } from './helpers/fixtures';

// The /history route is the hill-update LOG for a PHASE — a list of updates,
// newest first, no chart, with a back affordance that returns wherever the user
// actually came from.
//
// Programs and partners no longer have a page here (2026-07-20): their needle
// history is the detail popup on the entity's own page, deep-linkable at
// /programs/:id#status-history and covered by needle.spec.ts.

test.describe('History pages', () => {
  test.describe.configure({ mode: 'serial' });

  let seeded: SeededProgram;

  test.beforeAll(async () => {
    seeded = await seedProgram();
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test('phase history is a hill-update log with an honest back', async ({ page }) => {
    // Arrive FROM the program page — back must return there, not to a guess.
    await page.goto(`/programs/${seeded.projectId}`);
    await page.goto(`/history/phase/${seeded.phases.integration}`);

    await expect(page.locator('h1')).toContainText('R2 AAOS Bring-up');
    await expect(page.getByText('Every hill-chart update for this phase, newest first.')).toBeVisible();
    // No chart — this page is a log; the hill lives on the program page.
    await expect(page.locator('section svg')).toHaveCount(0);

    await page.getByRole('button', { name: '← Back' }).click();
    await page.waitForURL((u) => u.pathname === `/programs/${seeded.projectId}`);
  });

  test('program and partner history pages are gone — the popup replaced them', async ({ page }) => {
    for (const path of [`/history/project/${seeded.projectId}`, `/history/partner/${seeded.oemId}`]) {
      const res = await page.goto(path);
      expect(res?.status(), `${path} should not resolve`).toBe(404);
    }

    // The needle log is reachable on the program page instead, by deep link.
    await page.goto(`/programs/${seeded.projectId}#status-history`);
    await expect(page.getByTestId('needle-detail')).toBeVisible();
  });
});
