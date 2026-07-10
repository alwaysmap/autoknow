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

  test('should display project details and allow updating action item properties', async ({ page }) => {
    await page.goto(`/projects/${projectId}`);

    // Verify page content
    await expect(page.locator('h1')).toContainText('Android Car 2026');
    await expect(page.locator('body')).toContainText('Compliance Testing');
    await expect(page.locator('body')).toContainText('Fix CTS testCarService failing');

    // Perform update on action item status, next step, and link
    const itemContainer = page.locator(`.action-item-${actionItemId}`);
    await itemContainer.locator('select[name="nextStep"]').selectOption('Partner');
    await itemContainer.locator('input[name="linkUrl"]').fill('https://buganizer.corp.google.com/issues/12345');
    await itemContainer.locator('select[name="status"]').selectOption('Completed');
    
    // Submit the update
    await itemContainer.locator('button[type="submit"]').click();

    // Verify redirected page shows updated details
    await expect(page.locator(`.action-item-${actionItemId}`)).toContainText('Partner');
    await expect(page.locator(`.action-item-${actionItemId} a`)).toHaveAttribute('href', 'https://buganizer.corp.google.com/issues/12345');
    await expect(page.locator(`.action-item-${actionItemId}`)).toContainText('Completed');
  });

  test('should allow updating program progress + health via the gauge dialog', async ({ page }) => {
    await page.goto(`/projects/${projectId}`);

    // The Progress & Health card in the status dashboard
    const card = page.locator('[class*="summaryCard"]').filter({ hasText: 'Progress & Health' }).filter({ has: page.getByRole('button', { name: 'Update', exact: true }) });
    await card.getByRole('button', { name: 'Update', exact: true }).click();

    const dialog = page.locator('dialog[open]');
    await dialog.locator('input[type="range"]').fill('85');
    await dialog.locator('button:has-text("Concerned")').click();
    await dialog.locator('textarea[name="notes"]').fill('Critical timeline blockers piling up');
    await dialog.locator('button:has-text("Save Update")').click();

    // Verify the gauge card and activity reflect the update
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await expect(card).toContainText('Concerned', { timeout: 10000 });
    await expect(page.locator('body')).toContainText('Critical timeline blockers piling up');
  });

  test('should allow updating a phase by dragging the hill dot and leaving a note', async ({ page }) => {
    await page.goto(`/projects/${projectId}`);

    // The phase's row on the PhaseGraph rail (status derives from progress: 10 -> In Progress)
    const row = page.getByTestId('phase-row').filter({ hasText: 'Compliance Testing' });
    await expect(row).toContainText('In Progress');

    await row.getByRole('button', { name: 'Update', exact: true }).click();
    const dialog = page.locator('dialog[open]');
    await dialog.locator('input[name="hillChartProgress"]').fill('100');
    await dialog.locator('textarea[name="notes"]').fill('All CTS modules passing; phase complete.');
    await dialog.locator('button:has-text("Save Update")').click();

    // Progress 100 derives Done — the row collapses into the quiet completed state
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await expect(row).toContainText('Done', { timeout: 10000 });
    await expect(page.locator('body')).toContainText('All CTS modules passing; phase complete.');
  });
});
