import { test, expect } from '@playwright/test';
import { prisma } from './helpers/db';
import { wipeAll } from './helpers/fixtures';

test.describe('Project Details and Action Item Operations', () => {
  test.describe.configure({ mode: 'serial' });

  let projectId: number;
  let actionItemId: number;

  test.beforeAll(async () => {
    // Clear and seed clean state
    await wipeAll();

    const partner = await prisma.partner.create({
      data: { name: 'Google Partner PE', type: { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } } }
    });

    const project = await prisma.project.create({
      data: { name: 'Android Car 2026', partnerId: partner.id }
    });
    projectId = project.id;

    const phase = await prisma.phase.create({
      data: { name: 'Compliance Testing', projectId: project.id }
    });

    await prisma.phaseState.create({
      data: {
        phaseId: phase.id,
        status: 'Not Started',
        theNeedle: 'Low',
        hillChartProgress: 10
      }
    });

    const actionItem = await prisma.actionItem.create({
      data: {
        phaseId: phase.id,
        description: 'Fix CTS testCarService failing',
        status: 'Pending',
        nextStep: 'Undecided'
      }
    });
    actionItemId = actionItem.id;
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test('should display project details; the retired action-item editor is gone', async ({ page }) => {
    await page.goto(`/programs/${projectId}`);

    // Verify page content
    await expect(page.locator('h1')).toContainText('Android Car 2026');
    await expect(page.locator('body')).toContainText('Compliance Testing');

    // Action items no longer have a page-level editor (activities retired from the
    // phase surface; updates flow through Needle/Hill notes → the Gemini brief).
    await expect(page.getByRole('heading', { name: 'Actions & Decisions' })).toHaveCount(0);
    await expect(page.locator(`.action-item-${actionItemId}`)).toHaveCount(0);
  });

  test('should allow updating program progress + health via the gauge dialog', async ({ page }) => {
    await page.goto(`/programs/${projectId}`);

    // The Progress & Health card in the status dashboard
    const card = page.locator('[class*="summaryCard"]').filter({ hasText: 'Progress & Health' }).filter({ has: page.getByRole('button', { name: 'Update', exact: true }) });
    await card.getByRole('button', { name: 'Update', exact: true }).click();

    const dialog = page.locator('dialog[open]');
    await dialog.locator('input[type="range"]').fill('85');
    await dialog.locator('button:has-text("Concerned")').click();
    await dialog.locator('[data-testid="note-editor"] [contenteditable="true"]').click();
    await page.keyboard.type('Critical timeline blockers piling up');
    await dialog.locator('button:has-text("Save Update")').click();

    // Verify the gauge card and activity reflect the update
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await expect(card).toContainText('Concerned', { timeout: 10000 });
    await expect(page.locator('body')).toContainText('Critical timeline blockers piling up');
  });

  test('should allow updating a phase from its details popover', async ({ page }) => {
    await page.goto(`/programs/${projectId}`);

    // The phase's row on the PhaseTrack — status reads from glyphs, not words.
    const row = page.getByTestId('phase-row').filter({ hasText: 'Compliance Testing' });

    // Details lifts the phase into the focused popover over a scrim.
    await row.getByRole('button', { name: 'Details' }).click();
    const details = page.getByTestId('phase-details');
    await expect(details.getByRole('heading', { name: 'Compliance Testing' })).toBeVisible();
    await details.locator('input[id^="phaseHillProgress-"]').fill('100');
    await details.locator('[data-testid="note-editor"] [contenteditable="true"]').click();
    await page.keyboard.type('All CTS modules passing; phase complete.');
    await details.getByRole('button', { name: 'Save Update' }).click();

    // Progress 100 derives Done — the row collapses into the quiet completed state
    // (header only: the Details affordance folds away with the card body).
    await expect(row.getByRole('button', { name: 'Details' })).toHaveCount(0, { timeout: 10000 });
    await expect(page.locator('body')).toContainText('All CTS modules passing; phase complete.');
  });
});
