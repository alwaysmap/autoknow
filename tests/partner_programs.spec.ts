import { test, expect } from '@playwright/test';
import { prisma } from './helpers/db';
import { seedProgram, type SeededProgram } from './helpers/fixtures';

// Behavioral coverage for the partner page's Programs summary: partners either OWN a
// program (Project.partnerId) or are INVOLVED via phase links (PhasePartner), and the
// cards must say which, with the phases they touch.

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
    const card = page.locator('article[class*="PartnerPrograms"]').filter({ hasText: 'R2 AAOS Bring-up' });
    await expect(card).toContainText('Owner');
    // All four phases appear as chips, linked to their history.
    const { bringUp, integration, certification, audio } = seeded.phases;
    for (const phaseId of [bringUp, integration, certification, audio]) {
      await expect(card.locator(`a[href="/history/phase/${phaseId}"]`)).toBeVisible();
    }
  });

  test('a supplier sees programs it is involved in, scoped to its phases', async ({ page }) => {
    await page.goto(`/partners/${seeded.supplierId}`);

    await expect(page.locator('h1')).toContainText('Denso');
    const card = page.locator('article[class*="PartnerPrograms"]').filter({ hasText: 'R2 AAOS Bring-up' });
    await expect(card).toContainText('Involved');
    await expect(card).toContainText('Owned by');
    await expect(card.locator('a', { hasText: 'Rivian' })).toBeVisible();

    // Only the phase Denso touches is listed — with its role.
    await expect(card.locator(`a[href="/history/phase/${seeded.phases.integration}"]`)).toBeVisible();
    await expect(card).toContainText('Supplier');
    await expect(card.locator(`a[href="/history/phase/${seeded.phases.audio}"]`)).toHaveCount(0);
  });
});
