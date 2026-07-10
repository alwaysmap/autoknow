import { test, expect } from '@playwright/test';
import { prisma } from './helpers/db';
import { wipeAll } from './helpers/fixtures';

// The Progress & Health gauge ("Needle" internally) exists at two scopes:
//  - Partner: relationship health, in the partner page header.
//  - Project: program progress + health, in the status dashboard.
// Phase progress is a separate control (the hill chart) — see project_details.spec.ts.

test.describe('Progress & Health gauge updates', () => {
  test.describe.configure({ mode: 'serial' });

  let partnerId: number;
  let projectId: number;

  test.beforeAll(async () => {
    // Clear and seed test records
    await wipeAll();

    const partner = await prisma.partner.create({
      data: {
        name: 'Tesla Motors',
        type: { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } }
      }
    });
    partnerId = partner.id;

    const project = await prisma.project.create({
      data: {
        name: 'Tesla Model S Infotainment',
        partnerId: partner.id,
        ownerName: 'dylan',
        sopDate: new Date('2028-01-01'),
        volumeFirstYear: 500000,
        theNeedle: 'On Track'
      }
    });
    projectId = project.id;

    const phase = await prisma.phase.create({
      data: {
        name: 'AAOS Bring-up',
        projectId: project.id
      }
    });

    await prisma.phaseState.create({
      data: {
        phaseId: phase.id,
        status: 'In Progress',
        theNeedle: 'On Track',
        hillChartProgress: 10
      }
    });
  });

  test('should allow updating health at the Partner (relationship) level', async ({ page }) => {
    await page.goto(`/partners/${partnerId}`);

    const header = page.locator('header').filter({ hasText: 'Tesla Motors' });
    await header.getByRole('button', { name: 'Update', exact: true }).click();

    const dialog = page.locator('dialog[open]');
    await dialog.locator('input[type="range"]').fill('65');
    await dialog.locator('button:has-text("Some Risk")').click();
    await dialog.locator('textarea[name="notes"]').fill('Tesla partnership risk is elevated due to supply chains.');
    await dialog.locator('button:has-text("Save Update")').click();

    // Verify it closed and the header gauge now reads Some Risk
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await expect(header).toContainText('Some Risk');
  });

  test('should allow updating progress + health at the Project level', async ({ page }) => {
    await page.goto(`/projects/${projectId}`);

    // The Progress & Health card in the status dashboard
    const card = page.locator('[class*="summaryCard"]').filter({ hasText: 'Progress & Health' }).filter({ has: page.getByRole('button', { name: 'Update', exact: true }) });
    await expect(card).toContainText('On Track');
    await card.getByRole('button', { name: 'Update', exact: true }).click();

    const dialog = page.locator('dialog[open]');
    await dialog.locator('input[type="range"]').fill('35');
    await dialog.locator('button:has-text("Concerned")').click();
    await dialog.locator('textarea[name="notes"]').fill('Codec blockers piling up');
    await dialog.locator('button:has-text("Save Update")').click();

    // Verify the gauge card shows the new health and the note landed in activity
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await expect(card).toContainText('Concerned');
    await expect(page.locator('body')).toContainText('Codec blockers piling up');
  });
});
