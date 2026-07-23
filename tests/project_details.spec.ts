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

  // #24: the headline bug was menus opening OFF-SCREEN at phone widths (the ⋯ beside a
  // heading, the rightmost column filter) — unreachable because the page can't scroll
  // horizontally (§9). anchoredPosition.test.ts proves the clamp MATH; this proves the
  // component actually wires it to real geometry at 360px, in a real browser (this file
  // runs on chromium AND webkit/Safari — the reason CSS anchor positioning was rejected).
  test('at phone width the ⋯ menu opens fully inside the viewport, not off-screen (#24)', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto(`/programs/${projectId}`);

    const trigger = page.getByRole('button', { name: 'Phase actions' });
    const panel = page.getByRole('menu').filter({ has: page.getByRole('menuitem', { name: 'Edit phases →' }) });

    // Hydration-guarded first interaction (the repo's #1 e2e flake source otherwise).
    await expect(async () => {
      if (!(await panel.isVisible())) await trigger.click({ timeout: 2000 });
      await expect(panel).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 20000 });

    // The whole panel is within the 360px viewport — top-layer + clamp, not off the edge.
    const box = (await panel.boundingBox())!;
    expect(box).toBeTruthy();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(360);
  });

  // The row BODY carries the status card and the LABEL carries the jump (two targets
  // since #22), but the card must still be reachable without a pointer — a hover-only
  // card is a card half the users never see. Focus shows it; it must land clear of the
  // label column, because the names are what the reader uses to keep their place, so a
  // card that hides them costs more than it gives. (The touch split — body reveals,
  // label jumps — is proved in chain_touch.spec.ts, which needs a touch context.)
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

  // #82: pinned only to the pointer's right and clamped, the card parked against the
  // right edge and sat on top of the cells the reader was pointing at. It now FLIPS to
  // the pointer's left once past the section midpoint.
  test('the summary card flips to the pointer\'s left on the right half, clear of the cell (#82)', async ({ page }) => {
    await page.goto(`/programs/${projectId}`);
    const rows = page.locator('[class*="rowHit"]');
    const card = page.getByTestId('chain-row-card');

    await expect(rows.first()).toBeVisible({ timeout: 20000 });
    await rows.first().scrollIntoViewIfNeeded();
    const b = (await rows.first().boundingBox())!;
    const px = b.x + b.width * 0.82; // a point well into the RIGHT half of the chart
    const py = b.y + b.height / 2;

    // Hydration-guarded first interaction (the repo's #1 e2e flake source otherwise).
    await expect(async () => {
      await page.mouse.move(px, py);
      await expect(card).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 20000 });

    // Flipped left: the card's right edge sits left of the pointer, so it can never
    // cover the cell the pointer is on.
    const c = (await card.boundingBox())!;
    expect(c.x + c.width).toBeLessThanOrEqual(px);
  });

  // #75: the schedule can be zoomed to a focus window and slid. Zoom-in (from Fit it seeds a
  // window at half the chain, so it always produces one) makes the chart pannable and enables
  // zoom-out; Fit restores the whole chain and disables panning. Span-independent, so it holds
  // for any seeded chain.
  test('the schedule zooms into a focus window and Fit restores it (#75)', async ({ page }) => {
    await page.goto(`/programs/${projectId}`);
    const svg = page.locator('svg[class*="scheduleSvg"]');
    const zoomIn = page.getByRole('button', { name: 'Zoom in' });
    const zoomOut = page.getByRole('button', { name: 'Zoom out' });
    const fit = page.getByRole('button', { name: 'Fit', exact: true });

    // Fit is the resting state: not pannable, zoom-out disabled.
    await expect(svg).toHaveAttribute('data-pannable', 'false', { timeout: 20000 });
    await expect(zoomOut).toBeDisabled();

    // Hydration-guarded first interaction (the repo's #1 e2e flake source otherwise).
    await expect(async () => {
      await zoomIn.click();
      await expect(svg).toHaveAttribute('data-pannable', 'true', { timeout: 1500 });
    }).toPass({ timeout: 20000 });
    await expect(zoomOut).toBeEnabled();

    // Fit returns to the whole chain and switches panning back off.
    await fit.click();
    await expect(svg).toHaveAttribute('data-pannable', 'false');
    await expect(zoomOut).toBeDisabled();
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
        // Kebab items are role=menuitem now that the ⋯ menu is AnchoredPopover (#24).
        const item = page.getByTestId('project-meta').getByRole('menuitem', { name: 'Edit', exact: true });
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
