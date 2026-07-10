import { test, expect } from '@playwright/test';
import { prisma } from './helpers/db';
import { seedProgram, type SeededProgram } from './helpers/fixtures';

// Behavioral coverage for the status-history pages: programs chart progress AND health
// with needle list-cards; phases chart progress only (no health axis) with hill cards.

test.describe('History pages', () => {
  test.describe.configure({ mode: 'serial' });

  let seeded: SeededProgram;

  test.beforeAll(async () => {
    seeded = await seedProgram();
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test('program history shows health + progress and needle list-cards', async ({ page }) => {
    await page.goto(`/history/project/${seeded.projectId}`);

    await expect(page.locator('h1')).toContainText('R2 AAOS Bring-up');
    await expect(page.getByText('Progress & health over time.')).toBeVisible();

    // The weekly update renders as a list-card: health word + markdown note.
    const changes = page.locator('article').filter({ hasText: 'Concerned' });
    await expect(changes.first()).toContainText('Codec blockers slowing integration.');
  });

  test('phase history charts progress only and shows hill list-cards', async ({ page }) => {
    await page.goto(`/history/phase/${seeded.phases.integration}`);

    await expect(page.locator('h1')).toContainText('R2 AAOS Bring-up — Integration');
    // Phases have no health — the subtitle and chart must not mention it.
    await expect(page.getByText('Progress over time.')).toBeVisible();
    await expect(page.getByText('Progress & health over time.')).toHaveCount(0);

    const card = page.locator('article').filter({ hasText: 'In Progress' });
    await expect(card.first()).toContainText('Codec drops blocking the DSP path.');
    await expect(card.first()).toContainText('by testbot');
  });
});
