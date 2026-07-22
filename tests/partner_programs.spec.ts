import { test, expect } from '@playwright/test';
import { prisma } from './helpers/db';
import { seedProgram, type SeededProgram } from './helpers/fixtures';

// Behavioral coverage for the partner page's Programs list: partners either OWN a
// program (Project.partnerId) or are INVOLVED via phase links (PhasePartner). The
// briefing layout renders one disclosure row per program (expanded by default) —
// involved rows say "via <owner>" (the owner is a link). Owned rows list every
// phase; involved rows show all of the program's IN-FLIGHT phases (the partner's
// own phase additionally carries its role).

test.describe('Partner programs summary', () => {
  test.describe.configure({ mode: 'serial' });

  let seeded: SeededProgram;
  // A phase chip's destination: the DETAILS popover on the program page, deep-linked
  // (lib/phase). Phases have no page of their own.
  const detail = (phaseId: number) => `/programs/${seeded.projectId}#phase-${phaseId}-detail`;

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

    // Cards are expanded by default — all four phases show as chips deep-linked to
    // their DETAILS popover on the program page, without any interaction.
    const { bringUp, integration, certification, audio } = seeded.phases;
    for (const phaseId of [bringUp, integration, certification, audio]) {
      await expect(row.locator(`a[href="${detail(phaseId)}"]`)).toBeVisible();
    }
  });

  test('a supplier sees involved programs with all in-flight phases; its own phase carries the role', async ({ page }) => {
    await page.goto(`/partners/${seeded.supplierId}`);

    await expect(page.locator('h1')).toContainText('Denso');
    const row = page.locator('details').filter({ hasText: 'R2 AAOS Bring-up' });
    await expect(row).toBeVisible();
    // Involved rows attribute the owner — as a link (everything is a URL).
    await expect(row).toContainText('via');
    await expect(row.locator('a', { hasText: 'Rivian' })).toBeVisible();

    // All the program's IN-FLIGHT phases show (integration = Denso's, plus audio),
    // not just the one Denso sits on. Denso's phase carries its role; the done
    // (bringUp) and not-started (certification) phases are omitted.
    await expect(row.locator(`a[href="${detail(seeded.phases.integration)}"]`)).toBeVisible();
    await expect(row.locator(`a[href="${detail(seeded.phases.audio)}"]`)).toBeVisible();
    await expect(row).toContainText('Supplier'); // role on the integration phase
    await expect(row.locator(`a[href="${detail(seeded.phases.bringUp)}"]`)).toHaveCount(0);
    await expect(row.locator(`a[href="${detail(seeded.phases.certification)}"]`)).toHaveCount(0);
  });
});
