import { test, expect } from '@playwright/test';
import { prisma } from './helpers/db';
import { seedProgram, type SeededProgram } from './helpers/fixtures';

// Behavioral coverage for the partner page's Programs list: partners either OWN a
// program (Project.partnerId) or are INVOLVED via phase links (PhasePartner). The
// briefing layout renders one disclosure row per program — involved rows say
// "via <owner>" (the owner is a link), and expanding a row reveals the phase chips
// this partner touches.

test.describe('Partner programs summary', () => {
  test.describe.configure({ mode: 'serial' });

  let seeded: SeededProgram;

  test.beforeAll(async () => {
    seeded = await seedProgram();
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test('an OEM sees the program it owns with all phases', async ({ page }) => {
    await page.goto(`/partners/${seeded.oemId}`);

    await expect(page.locator('h1')).toContainText('Rivian');
    const row = page.locator('details').filter({ hasText: 'R2 AAOS Bring-up' });
    await expect(row).toBeVisible();
    // Owned, not involved — no "via <owner>" attribution on the row.
    await expect(row.locator(`a[href="/partners/${seeded.oemId}"]`)).toHaveCount(0);

    // Expanding the row reveals all four phases as chips linked to their history.
    await row.locator('summary > span').first().click(); // the chevron, clear of the name link
    const { bringUp, integration, certification, audio } = seeded.phases;
    for (const phaseId of [bringUp, integration, certification, audio]) {
      await expect(row.locator(`a[href="/history/phase/${phaseId}"]`)).toBeVisible();
    }
  });

  test('a supplier sees programs it is involved in, scoped to its phases', async ({ page }) => {
    await page.goto(`/partners/${seeded.supplierId}`);

    await expect(page.locator('h1')).toContainText('Denso');
    const row = page.locator('details').filter({ hasText: 'R2 AAOS Bring-up' });
    await expect(row).toBeVisible();
    // Involved rows attribute the owner — as a link (everything is a URL).
    await expect(row).toContainText('via');
    await expect(row.locator('a', { hasText: 'Rivian' })).toBeVisible();

    // Only the phase Denso touches is listed — with its role.
    await row.locator('summary > span').first().click();
    await expect(row.locator(`a[href="/history/phase/${seeded.phases.integration}"]`)).toBeVisible();
    await expect(row).toContainText('Supplier');
    await expect(row.locator(`a[href="/history/phase/${seeded.phases.audio}"]`)).toHaveCount(0);
  });
});
