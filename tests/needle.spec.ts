import { test, expect, type Page, type Locator } from './helpers/e2e';
import { prisma } from './helpers/db';
import { wipeAll } from './helpers/fixtures';

// Status controls by scope:
//  - Partner: relationship health on the colorless 1..5 scale, in the partner page
//    header (NOT a needle — see lib/relationship).
//  - Project: program progress + health via the Needle gauge, in the status dashboard.
// Phase progress is a separate control (the hill chart) — see project_details.spec.ts.


// Opening the detail popup: hydration-guarded (the first click can be swallowed)
// and scrolled to the top first, since the sticky nav otherwise intercepts the
// click on the status row.
async function openDetail(page: Page, card: Locator, dialog: Locator) {
  await expect(async () => {
    if (!(await dialog.isVisible())) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await card.getByRole('button', { name: 'Detail', exact: true }).click({ timeout: 2000 });
    }
    await expect(dialog).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 20000 });
}

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
        type: { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } }, region: { connectOrCreate: { where: { name: 'AMER' }, create: { name: 'AMER' } } }
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

    // The relationship unit lives in the Key Details sidebar block.
    const scale = page.getByTestId('relationship-scale');
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

    // The resting row states the fact and offers ONE way in: Detail.
    const card = page.locator('[class*="summaryCard"]')
      .filter({ has: page.getByRole('button', { name: 'Detail', exact: true }) });
    await expect(card).toContainText('On Track');

    const dialog = page.getByTestId('needle-detail');
    await openDetail(page, card, dialog);

    // UPDATE reveals the form inside this same popup — never a second modal.
    await dialog.getByRole('button', { name: 'Update', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(1);

    await dialog.locator('input[type="range"]').fill('35');
    await dialog.locator('button:has-text("Concerned")').click();
    await dialog.locator('[data-testid="note-editor"] [contenteditable="true"]').click();
    await page.keyboard.type('Codec blockers piling up');
    await dialog.locator('button:has-text("Save Update")').click();

    // The detail popup stays open by design; only the form closes.
    await expect(dialog.locator('form')).toHaveCount(0);
    await expect(card).toContainText('Concerned');
    await expect(page.locator('body')).toContainText('Codec blockers piling up');
  });

  test('Detail popup: complete log with author, and UPDATE in place', async ({ page }) => {
    await page.goto(`/programs/${projectId}`);
    const card = page.locator('[class*="summaryCard"]')
      .filter({ has: page.getByRole('button', { name: 'Detail', exact: true }) });
    const detail = page.getByTestId('needle-detail');
    await openDetail(page, card, detail);

    // Each entry carries the health label, WHO wrote it, the timestamp, and the
    // note in full — the note never appears beside the gauge itself.
    const newest = detail.locator('article').first();
    await expect(newest).toContainText('Concerned');
    await expect(newest).toContainText('by dylan');
    await expect(newest).toContainText('Codec blockers piling up');

    // UPDATE opens the form in this popup; the log stays put behind it.
    await detail.getByRole('button', { name: 'Update', exact: true }).click();
    await expect(detail.locator('form')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(1); // never two modals

    // Cancel abandons the update and restores the log's actions.
    await detail.locator('button:has-text("Cancel")').click();
    await expect(detail.locator('form')).toHaveCount(0);
    await expect(detail.getByRole('button', { name: 'Update', exact: true })).toBeVisible();

    // Reopen and save for real. (The required-note gate itself is covered by the
    // project- and partner-level tests; re-testing it here would mean typing into
    // the editor after React's form action resets it, which the driver types into
    // unreliably even though a real user's retype syncs fine.)
    await detail.getByRole('button', { name: 'Update', exact: true }).click();
    await detail.locator('[data-testid="note-editor"] [contenteditable="true"]').click();
    await page.keyboard.type('Codec supplier committed to a fix window.');
    await expect(detail.locator('input[name="notes"]')).toHaveValue(/Codec supplier/);
    await detail.locator('button:has-text("Save Update")').click();
    await expect(detail.locator('form')).toHaveCount(0);

    const states = await prisma.projectState.findMany({ where: { projectId }, orderBy: { timestamp: 'desc' } });
    expect(states[0]?.notes).toContain('Codec supplier committed');
    expect(states[0]?.source).toBeTruthy(); // author is stamped, so the log can show it

    // Both updates now read in the log, newest first.
    await openDetail(page, card, detail);
    await expect(detail.locator('article').first()).toContainText('Codec supplier committed to a fix window.');
    await expect(detail).toContainText('Codec blockers piling up');
  });

  // In UPDATE mode the popup used to show the form's Cancel/Save AND a dialog-level
  // Close at once, and Close (plus the ×, Escape, backdrop) threw away a typed note with
  // no prompt (#35). Now: one action row while editing, and every dismissal path asks
  // first when there is unsaved work.
  test('Update mode: no duplicate Close, and a stray dismissal cannot silently drop an edit', async ({ page }) => {
    await page.goto(`/programs/${projectId}`);
    const card = page.locator('[class*="summaryCard"]')
      .filter({ has: page.getByRole('button', { name: 'Detail', exact: true }) });
    const detail = page.getByTestId('needle-detail');
    await openDetail(page, card, detail);

    // Log mode shows the dialog-level Close rail.
    await expect(detail.locator('button:has-text("Close")')).toHaveCount(1);

    await detail.getByRole('button', { name: 'Update', exact: true }).click();
    await expect(detail.locator('form')).toBeVisible();

    // Editing: the footer Close is gone — the form's own Cancel/Save is the only action
    // row (the × in the header carries no visible "Close" text, so this counts the rail).
    await expect(detail.locator('button:has-text("Close")')).toHaveCount(0);
    await expect(detail.locator('button:has-text("Cancel")')).toHaveCount(1);

    // Make the form dirty, then try to close via the header × — it must ASK first.
    await detail.locator('[data-testid="note-editor"] [contenteditable="true"]').click();
    await page.keyboard.type('Half-typed note that must not vanish');

    let asked = false;
    page.once('dialog', (d) => { asked = true; d.dismiss(); }); // decline → keep editing
    await detail.getByRole('button', { name: 'Close', exact: true }).click(); // the × (aria-label Close)
    await expect.poll(() => asked).toBe(true);
    await expect(detail.locator('form')).toBeVisible(); // the edit survived the stray close

    // A second try, accepted this time, discards and closes.
    page.once('dialog', (d) => d.accept());
    await detail.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.locator('dialog[open]')).toHaveCount(0);

    // Pristine form must NOT nag: reopen, enter update, change nothing, and a guarded path
    // (Escape) closes with no prompt at all.
    await openDetail(page, card, detail);
    await detail.getByRole('button', { name: 'Update', exact: true }).click();
    await expect(detail.locator('form')).toBeVisible();
    let nagged = false;
    page.once('dialog', (d) => { nagged = true; d.accept(); });
    await page.keyboard.press('Escape');
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    expect(nagged).toBe(false);
  });

  // MDXEditor ships its own palette and ignores our tokens, so for a while the
  // update field rendered near-black ink on our dark paper — invisible, and no
  // test noticed because every other assertion is about text CONTENT, which was
  // there the whole time. This one is about whether a human can read it.
  test('the note editor is legible on the dark theme', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('autoknow-theme', 'dark'));
    await page.goto(`/programs/${projectId}`);

    const card = page.locator('[class*="summaryCard"]')
      .filter({ has: page.getByRole('button', { name: 'Detail', exact: true }) });
    const detail = page.getByTestId('needle-detail');
    await openDetail(page, card, detail);
    await detail.getByRole('button', { name: 'Update', exact: true }).click();

    const canvas = detail.locator('[data-testid="note-editor"] [contenteditable="true"]');
    await expect(canvas).toBeVisible();

    // Ink and paper must land on opposite ends of the scale. Comparing relative
    // luminance beats asserting an exact colour, which would just re-encode the
    // package's palette into the test.
    const luminance = async (loc: ReturnType<typeof detail.locator>, prop: string) =>
      loc.evaluate((el, p) => {
        const [r, g, b] = getComputedStyle(el)[p as 'color']
          .match(/[\d.]+/g)!.slice(0, 3)
          .map((v) => (parseFloat(v) > 1 ? parseFloat(v) / 255 : parseFloat(v)))
          .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      }, prop);

    const ink = await luminance(canvas, 'color');
    const paper = await luminance(detail.locator('[data-testid="note-editor"]'), 'backgroundColor');
    expect(ink).toBeGreaterThan(0.5); // light ink…
    expect(paper).toBeLessThan(0.1); // …on dark paper

    // And the writing surface is left-aligned, never centred by an ancestor.
    await expect(canvas).toHaveCSS('text-align', 'left');
  });
});
