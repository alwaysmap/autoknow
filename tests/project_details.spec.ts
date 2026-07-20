import { test, expect } from '@playwright/test';
import { prisma } from './helpers/db';
import { wipeAll } from './helpers/fixtures';

test.describe('Project Details and Action Item Operations', () => {
  test.describe.configure({ mode: 'serial' });

  let projectId: number;

  test.beforeAll(async () => {
    // Clear and seed clean state
    await wipeAll();

    const partner = await prisma.partner.create({
      data: { name: 'Google Partner PE', type: { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } }, region: { connectOrCreate: { where: { name: 'AMER' }, create: { name: 'AMER' } } } }
    });

    const project = await prisma.project.create({
      data: { name: 'Android Car 2026', partnerId: partner.id }
    });
    projectId = project.id;

    // The Edit dialog's owner is a required pick from existing people.
    await prisma.person.create({
      data: { name: 'Priya PM', email: 'priya@google.com', currentPartnerId: partner.id }
    });

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

    await prisma.actionItem.create({
      data: {
        phaseId: phase.id,
        description: 'Fix CTS testCarService failing',
        status: 'Pending',
        nextStep: 'Undecided'
      }
    });
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });


  test('lead partner (OEM) is editable from the program Edit dialog', async ({ page }) => {
    // A second OEM to switch to.
    const bmw = await prisma.partner.create({
      data: { name: 'BMW Group', type: { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } }, region: { connectOrCreate: { where: { name: 'AMER' }, create: { name: 'AMER' } } } },
    });

    await page.goto(`/programs/${projectId}`);

    // Hydration-guarded open of the metadata edit dialog.
    const dialog = page.locator('dialog[open]');
    await expect(async () => {
      if (!(await dialog.isVisible())) {
        const item = page.getByTestId('project-meta').getByRole('button', { name: 'Edit', exact: true });
        if (!(await item.isVisible())) await page.getByTestId('kebab-menu').click({ timeout: 2000 });
        await item.click({ timeout: 2000 });
      }
      await expect(dialog).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 20000 });

    await dialog.locator('#editLeadPartner').selectOption({ label: 'BMW Group (OEM)' });
    // Owner is a required pick from existing people (no freeform entry).
    await dialog.locator('#editOwner').selectOption('priya@google.com');
    await dialog.locator('#editSop').fill('2027-06');
    await dialog.getByRole('button', { name: /Save/ }).click();
    await expect(page.locator('dialog[open]')).toHaveCount(0);

    // The header's OEM pill now names the new lead partner…
    await expect(page.getByTestId('project-meta')).toContainText('BMW Group');
    // …and the change is persisted, not cosmetic.
    const row = await prisma.project.findUnique({ where: { id: projectId }, select: { partnerId: true } });
    expect(row?.partnerId).toBe(bmw.id);
  });

  test('should allow updating program progress + health via the gauge dialog', async ({ page }) => {
    await page.goto(`/programs/${projectId}`);

    // The Progress & Health card: the row offers DETAIL, and the update form
    // opens inside that popup (see NeedleGauge / needle.spec.ts).
    const card = page.locator('[class*="summaryCard"]')
      .filter({ has: page.getByRole('button', { name: 'Detail', exact: true }) });
    const dialog = page.getByTestId('needle-detail');
    await expect(async () => {
      if (!(await dialog.isVisible())) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await card.getByRole('button', { name: 'Detail', exact: true }).click({ timeout: 2000 });
      }
      await expect(dialog).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 20000 });
    await dialog.getByRole('button', { name: 'Update', exact: true }).click();

    await dialog.locator('input[type="range"]').fill('85');
    await dialog.locator('button:has-text("Concerned")').click();
    await dialog.locator('[data-testid="note-editor"] [contenteditable="true"]').click();
    await page.keyboard.type('Critical timeline blockers piling up');
    await dialog.locator('button:has-text("Save Update")').click();

    // Verify the gauge card and activity reflect the update
    await expect(dialog.locator('form')).toHaveCount(0);
    await expect(card).toContainText('Concerned', { timeout: 10000 });
    await expect(page.locator('body')).toContainText('Critical timeline blockers piling up');
  });

  test('should allow updating a phase from its details popover', async ({ page }) => {
    await page.goto(`/programs/${projectId}`);

    // The phase's row on the PhaseTrack — status reads from glyphs, not words.
    const row = page.getByTestId('phase-row').filter({ hasText: 'Compliance Testing' });

    // Details lifts the phase into the focused popover over a scrim. Hydration-
    // resilient open: click only while closed (see phase_graph.spec.ts helper).
    const details = page.getByTestId('phase-details');
    await expect(async () => {
      if (!(await details.isVisible())) {
        await row.getByRole('button', { name: 'Details' }).click({ timeout: 2000 });
      }
      await expect(details).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 20000 });
    await expect(details.getByRole('heading', { name: 'Compliance Testing' })).toBeVisible();
    // View mode at rest — the Update affordance reveals the ball + note editor.
    await details.getByRole('button', { name: 'Update', exact: true }).click();
    await details.locator('input[id^="phaseHillProgress-"]').fill('100');
    await details.locator('[data-testid="note-editor"] [contenteditable="true"]').click();
    await page.keyboard.type('All CTS modules passing; phase complete.');
    await details.getByRole('button', { name: 'Save Update' }).click();

    // Save flips back to the story view (popover stays open); close it to read the rail.
    await expect(details).toContainText('All CTS modules passing; phase complete.');
    await page.keyboard.press('Escape');

    // Progress 100 derives Done — the row collapses into the quiet completed state.
    // Details stays reachable even collapsed (rows default to hide-all now).
    await expect(row.getByRole('button', { name: 'Details' })).toBeVisible({ timeout: 10000 });
    await expect(page.locator('body')).toContainText('All CTS modules passing; phase complete.');
  });
});
