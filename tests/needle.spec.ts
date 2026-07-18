import { test, expect } from '@playwright/test';
import { prisma } from './helpers/db';
import { wipeAll } from './helpers/fixtures';

// Status controls by scope:
//  - Partner: relationship health on the colorless 1..5 scale, in the partner page
//    header (NOT a needle — see lib/relationship).
//  - Project: program progress + health via the Needle gauge, in the status dashboard.
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

  test('should allow updating relationship health on the 1..5 scale at the Partner level', async ({ page }) => {
    await page.goto(`/partners/${partnerId}`);

    const header = page.locator('header').filter({ hasText: 'Tesla Motors' });
    const scale = header.getByTestId('relationship-scale');
    await expect(scale).toContainText('Not rated'); // no state logged yet — honest empty

    // Hydration-guarded open (first click can be swallowed under load).
    const dialog = page.locator('dialog[open]');
    await expect(async () => {
      if (!(await dialog.isVisible())) {
        await scale.getByRole('button', { name: 'Update', exact: true }).click({ timeout: 2000 });
      }
      await expect(dialog).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 20000 });

    // Pick 3 on the scale — the descriptor confirms the selection, no colors involved.
    await dialog.getByRole('radio', { name: '3', exact: true }).click();
    await expect(dialog).toContainText('Steady');

    // The note is required.
    await dialog.locator('button:has-text("Save Update")').click();
    await expect(dialog).toContainText('An update needs a note');

    await dialog.locator('[data-testid="note-editor"] [contenteditable="true"]').click();
    await page.keyboard.type('Tesla relationship is strained due to supply chains.');
    await dialog.locator('button:has-text("Save Update")').click();

    // Verify it closed and the header face carries the new position (the face is
    // the single visible measure; score + descriptor live in its accessible name).
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await expect(scale.getByRole('img', { name: /3\/5 — Steady/ }).first()).toBeVisible();

    // The state row carries the score AND the derived health (feed/filters coherence).
    const state = await prisma.partnerState.findFirst({ where: { partnerId }, orderBy: { timestamp: 'desc' } });
    expect(state?.relationshipScore).toBe(3);
    expect(state?.theNeedle).toBe('Some Risk');
  });

  test('should allow updating progress + health at the Project level', async ({ page }) => {
    await page.goto(`/programs/${projectId}`);

    // The Progress & Health card in the status dashboard
    const card = page.locator('[class*="summaryCard"]').filter({ hasText: 'Progress & Health' }).filter({ has: page.getByRole('button', { name: 'Update', exact: true }) });
    await expect(card).toContainText('On Track');
    await card.getByRole('button', { name: 'Update', exact: true }).click();

    const dialog = page.locator('dialog[open]');
    await dialog.locator('input[type="range"]').fill('35');
    await dialog.locator('button:has-text("Concerned")').click();
    await dialog.locator('[data-testid="note-editor"] [contenteditable="true"]').click();
    await page.keyboard.type('Codec blockers piling up');
    await dialog.locator('button:has-text("Save Update")').click();

    // Verify the gauge card shows the new health and the note landed in activity
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await expect(card).toContainText('Concerned');
    await expect(page.locator('body')).toContainText('Codec blockers piling up');
  });
});
