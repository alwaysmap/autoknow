import { test, expect } from '@playwright/test';
import { prisma } from './helpers/db';
import { seedProgram, type SeededProgram } from './helpers/fixtures';

// Behavioral coverage for the ProgramBrief card (spec §2.12). The test server runs with
// GEMINI_API_KEY unset, so the card must degrade HONESTLY: state that briefs are off,
// and never offer to generate (nothing may fake a synthesis).

test.describe('Program brief', () => {
  test.describe.configure({ mode: 'serial' });

  let seeded: SeededProgram;

  test.beforeAll(async () => {
    seeded = await seedProgram();
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test('degrades to an honest empty state when Gemini is unconfigured', async ({ page }) => {
    await page.goto(`/programs/${seeded.projectId}`);

    await expect(page.getByRole('heading', { name: 'Program brief' })).toBeVisible();
    await expect(page.getByText('AI briefs are off')).toBeVisible();
    await expect(page.getByRole('button', { name: /Generate brief|Refresh/ })).toHaveCount(0);
  });

  test('the on-demand API refuses cleanly without a key', async ({ request }) => {
    const response = await request.post(`/api/projects/${seeded.projectId}/brief`);
    expect(response.status()).toBe(503);
    const body = await response.json();
    expect(body.error).toContain('Gemini is not configured');
    // Nothing was persisted.
    expect(await prisma.programBrief.count()).toBe(0);
  });
});
