import { test, expect, type Page } from '@playwright/test';
import { prisma } from './helpers/db';
import { seedProgram, type SeededProgram } from './helpers/fixtures';

// Not an assertion suite — this captures screenshots of the phase UI surfaces
// (PhaseTrack rail + details, and the /templates authoring page) into ./screenshots
// so the current state can be eyeballed. Reuses the deterministic seedProgram fixture.

test.describe('Phase UI screenshots', () => {
  test.describe.configure({ mode: 'serial' });

  let seeded: SeededProgram;

  test.beforeAll(async () => {
    seeded = await seedProgram();
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  const row = (page: Page, name: string) =>
    page.getByTestId('phase-row').filter({ has: page.locator(`a:text-is("${name}")`) });

  test('phase rail', async ({ page }) => {
    await page.goto(`/programs/${seeded.projectId}`);
    await page.getByTestId('phase-row').first().waitFor();
    await page.screenshot({ path: 'screenshots/01-phase-rail.png', fullPage: true });
  });

  test('phase details', async ({ page }) => {
    await page.goto(`/programs/${seeded.projectId}`);
    // hydration-resilient open (see phase_graph.spec.ts)
    await expect(async () => {
      if (!(await page.getByTestId('phase-details').isVisible())) {
        // MIN is one line, so the card opens before the zoom button exists.
        const zoom = row(page, 'Integration').getByRole('button', { name: 'Details' });
        if (!(await zoom.isVisible())) await row(page, 'Integration').locator('a[data-card-title]').click();
        await zoom.click({ timeout: 2000 });
      }
      await expect(page.getByTestId('phase-details')).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 20000 });
    await page.screenshot({ path: 'screenshots/02-phase-details.png', fullPage: true });
  });

  test('templates list', async ({ page }) => {
    await page.goto('/templates');
    await page.getByTestId('template-row').first().waitFor();
    await page.screenshot({ path: 'screenshots/03-templates-list.png', fullPage: true });
  });

  test('template editor', async ({ page }) => {
    await page.goto('/templates');
    await page.getByTestId('template-row').filter({ hasText: 'Digital Key' }).first()
      .getByRole('button', { name: 'Clone' }).click();
    await page.waitForURL(/\/templates\/\d+\/edit/);
    await page.getByTestId('phase-card').first().waitFor();
    await page.screenshot({ path: 'screenshots/04-template-editor.png', fullPage: true });
  });
});
