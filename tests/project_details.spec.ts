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


  // design.md §8c fixes ONE heading order — text → affordances (ⓘ, menus) →
  // graticule to the end of the line — and prose alone did not hold it: PhaseTrack
  // rendered its ⓘ/⋯ as SIBLINGS of AnchorHeading. The graticule is a ::after on
  // the heading row, so it can only ever be last WITHIN that row; a sibling lands
  // after the whole row and gets flung to the far right, divorced from the title it
  // acts on, with its left-anchored popup opening off the container's edge.
  // Geometry, not DOM shape, so this holds in both styles and for any future header.
  test('the Phases affordances sit against the title, not at the far edge', async ({ page }) => {
    await page.goto(`/programs/${projectId}`);
    const heading = page.locator('h2#phases');
    const menu = page.getByRole('button', { name: 'Phase actions' });

    await expect(async () => {
      const h = await heading.boundingBox();
      const m = await menu.boundingBox();
      const section = await heading.locator('xpath=ancestor::section[1]').boundingBox();
      expect(h && m && section).toBeTruthy();

      // Adjacent to the title: the gap fits the # anchor and the ⓘ, nothing more.
      const gap = m!.x - (h!.x + h!.width);
      expect(gap).toBeGreaterThanOrEqual(0);
      expect(gap).toBeLessThan(80);

      // And decisively NOT pinned to the right edge — that is where the filler goes,
      // and where a popup would have no room to open.
      const fromRight = section!.x + section!.width - (m!.x + m!.width);
      expect(fromRight).toBeGreaterThan(200);
    }).toPass({ timeout: 20000 });

    // The menu opens fully inside the section rather than off its right edge.
    await menu.click();
    const item = page.getByRole('menuitem', { name: 'Edit phases →' });
    await expect(item).toBeVisible();
    const box = (await item.boundingBox())!;
    const section = (await heading.locator('xpath=ancestor::section[1]').boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(section.x + section.width);
  });

  // A schedule row is ONE target covering label, bar and trailing note, and its card
  // must be reachable without a pointer — a hover-only card is a card half the users
  // never see. It also must not cover the label column: the names are what the reader
  // uses to keep their place, so a card that hides them costs more than it gives.
  test('a critical-chain row offers a keyboard-reachable card, clear of the labels', async ({ page }) => {
    await page.goto(`/programs/${projectId}`);
    const rows = page.locator('[class*="rowHit"]');
    const card = page.getByTestId('chain-row-card');

    await expect(async () => {
      await rows.first().focus();
      await expect(card).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 20000 });

    // It names the phase whose row it belongs to, and says something about the buffer.
    await expect(card).toContainText('Compliance Testing');

    const labels = page.locator('[class*="rowLabel"]').first();
    const labelBox = (await labels.boundingBox())!;
    const cardBox = (await card.boundingBox())!;
    expect(cardBox.x).toBeGreaterThanOrEqual(labelBox.x + labelBox.width);

    // Blur clears it — it must not strand itself on screen.
    await rows.first().blur();
    await expect(card).toHaveCount(0);
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
    // MIN is one line (name + plan), so open the card before reaching for the zoom.
    const details = page.getByTestId('phase-details');
    await expect(async () => {
      if (!(await details.isVisible())) {
        const zoom = row.getByRole('button', { name: 'Details' });
        if (!(await zoom.isVisible())) await row.locator('a[data-card-title]').click();
        await zoom.click({ timeout: 2000 });
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

    // Progress 100 derives Done — the row keeps the quiet completed state, and the
    // card is still at standard size from the open above, so its zoom stays there.
    await expect(row.getByRole('button', { name: 'Details' })).toBeVisible({ timeout: 10000 });
    await expect(page.locator('body')).toContainText('All CTS modules passing; phase complete.');
  });
});
