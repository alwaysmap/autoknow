import { test, expect, type Page } from '@playwright/test';
import { prisma } from './helpers/db';
import { seedProgram, type SeededProgram } from './helpers/fixtures';

// Behavioral coverage for the PhaseTrack train-line surface (spec §2.13) and the
// program phase editor: critical chain + explained constraint, compact read-only
// cards (typed involvement pills, no role labels, no status words), the focused
// popover (required-note status update, involvement editing, read-only dependencies),
// and structural editing gated behind whole-graph DAG validation.

test.describe('PhaseTrack rail', () => {
  test.describe.configure({ mode: 'serial' });

  let seeded: SeededProgram;

  test.beforeAll(async () => {
    seeded = await seedProgram();
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  // Match by the row's name anchor exactly — substring matching would also catch rows
  // whose notes mention another phase's name.
  const row = (page: Page, name: string) =>
    page.getByTestId('phase-row').filter({ has: page.locator(`a:text-is("${name}")`) });
  const details = (page: Page) => page.getByTestId('phase-details');
  const openDetails = async (page: Page, name: string) => {
    // Hydration-resilient open: a click can land before React attaches the handler
    // on a cold dev-server load, and a swallowed click is never retried by expect().
    // Only click while the popover is closed (a late-opening popover scrims the
    // button, so a blind retry-click would hang on it).
    await expect(async () => {
      if (!(await details(page).isVisible())) {
        await row(page, name).getByRole('button', { name: 'Details' }).click({ timeout: 2000 });
      }
      await expect(details(page)).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 20000 });
  };


  // The phase name link carries a `title` ("Done · click to trace its dependencies").
  // Per accname, a link takes its name from its CONTENT and falls back to `title`
  // only when there is none — but that ordering is easy to break by accident (an
  // aria-label added "for clarity", or wrapping the text in an aria-hidden span),
  // and the failure is invisible: sighted users see the phase name while every row
  // announces the same generic string, and the rows stop being tellable apart. So
  // assert the NAME, not the markup.
  test('a phase is reachable by its own name, not by its tooltip', async ({ page }) => {
    await page.goto(`/programs/${seeded.projectId}`);
    await expect(page.getByRole('link', { name: 'Bring-up', exact: true })).toBeVisible();
    // And the tooltip text is NOT what names it.
    await expect(page.getByRole('link', { name: /click to trace/ })).toHaveCount(0);
  });

  // A trace has to distinguish the two DIRECTIONS, not just related-vs-not. On a
  // phase every other phase happens to sit on a path through — the spine of a
  // converging plan — a related/unrelated scale dims nothing, so the click reads as
  // "nothing happened" (it was 6 of 15 phases on the AAOS template). Asserting the
  // four levels on the fixture's diamond: Bring-up → Integration → Certification,
  // with Audio hanging off Bring-up and therefore unrelated to Integration.
  test('tracing separates upstream, downstream and unrelated', async ({ page }) => {
    await page.goto(`/programs/${seeded.projectId}`);
    const rel = (name: string) => row(page, name).getAttribute('data-rel');

    await expect(async () => {
      await row(page, 'Integration').locator('a:text-is("Integration")').click({ timeout: 2000 });
      expect(await rel('Integration')).toBe('self');
    }).toPass({ timeout: 20000 });

    expect(await rel('Bring-up')).toBe('up');        // what Integration waits FOR
    expect(await rel('Certification')).toBe('down'); // what waits ON Integration
    expect(await rel('Audio')).toBe('far');          // a sibling branch, on no path through it

    // Receded rows keep real controls, so they must not be left reachable-but-unreadable.
    const audio = row(page, 'Audio');
    await audio.locator('a:text-is("Audio")').focus();
    await expect(audio).toHaveCSS('opacity', '1');
  });

  test('cards are compact: typed pills without role labels, no status words', async ({ page }) => {
    await page.goto(`/programs/${seeded.projectId}`);

    // Done phase starts collapsed: header line only. Details stays reachable even
    // collapsed (rows default to hide-all).
    const bringUp = row(page, 'Bring-up');
    await expect(bringUp.getByRole('button', { name: 'Details' })).toBeVisible();

    // Status is carried by glyphs, not words, on the card header.
    await expect(bringUp).not.toContainText('Done');
    const integration = row(page, 'Integration');
    await expect(integration).not.toContainText('In Progress');

    // Involvement renders as pills — names only, the colour carries the company
    // type. Rows default collapsed: expand first.
    const toggle = integration.locator('button[aria-label^="Toggle detail"]');
    await toggle.click();
    await expect(integration).toContainText('Denso');
    await expect(integration).toContainText('Kenji Sato');
    await expect(integration).not.toContainText('FAE');

    // The caret folds the card away again; Details stays reachable either way.
    await expect(integration.getByRole('button', { name: 'Details' })).toBeVisible();
    await toggle.click();
    await expect(integration).not.toContainText('Denso');
    await expect(integration.getByRole('button', { name: 'Details' })).toBeVisible();
    await toggle.click();
    await expect(integration.getByRole('button', { name: 'Details' })).toBeVisible();
  });



  test('the popover is a modal over the rail; Esc closes it', async ({ page }) => {
    await page.goto(`/programs/${seeded.projectId}`);
    const url = page.url();

    await openDetails(page, 'Audio');
    expect(page.url()).toBe(url); // same page — no navigation, no <dialog>
    await expect(page.getByRole('dialog', { name: 'Audio' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(details(page)).toHaveCount(0);
  });

  test('a hill update REQUIRES a note; saving records history', async ({ page }) => {
    await page.goto(`/programs/${seeded.projectId}`);
    await openDetails(page, 'Audio');

    // The pane rests in view mode — the Update affordance reveals ball + editor.
    await details(page).getByRole('button', { name: 'Update', exact: true }).click();

    // Move the dot but say nothing → blocked with the inline error, still open.
    await details(page).locator('input[id^="phaseHillProgress-"]').fill('55');
    await details(page).getByRole('button', { name: 'Save Update' }).click();
    await expect(details(page)).toContainText('A progress change needs a note');
    await expect(details(page)).toBeVisible();

    // Write the note in the WYSIWYG editor (markdown under the hood) and save.
    await details(page).locator('[data-testid="note-editor"] [contenteditable="true"]').click();
    await page.keyboard.type('Codec samples landed; over the hill.');
    await details(page).getByRole('button', { name: 'Save Update' }).click();

    // Save drops back to the view-mode story: the fresh update leads, big.
    await expect(details(page)).toContainText('Codec samples landed; over the hill.');
    await page.keyboard.press('Escape');
    await expect(details(page)).toHaveCount(0);

    // Back on the track: the card (expanded — rows default collapsed) shows the
    // new note but NOT the history list.
    const audio = row(page, 'Audio');
    await audio.locator('button[aria-label^="Toggle detail"]').click();
    await expect(audio).toContainText('Codec samples landed; over the hill.', { timeout: 10000 });
    await expect(audio.getByText('History')).toHaveCount(0);

    // The history (with the prior update) lives on the popover.
    await openDetails(page, 'Audio');
    await expect(details(page).getByText('History', { exact: true })).toBeVisible();
    // The LATEST update is the big headline; only the older one renders as a
    // compact history card.
    await expect(details(page).locator('[class*="latestUpdate"]')).toContainText('Codec samples landed');
    await expect(details(page).locator('[class*="historyList"] article')).toHaveCount(1);
  });

  test('partner involvement is editable on the popover', async ({ page }) => {
    await page.goto(`/programs/${seeded.projectId}`);
    await openDetails(page, 'Integration');

    // Seeded involvement is visible with its role (roles live HERE, not on the rail).
    const densoChip = details(page).locator('[class*="partnerChip"]').filter({ hasText: 'Denso' });
    await expect(densoChip).toContainText('Supplier');

    // Add another partner with a role — the ghost "+" reveals the small form.
    await details(page).getByRole('button', { name: 'Partner to involve' }).click();
    await details(page).locator('select[aria-label="Partner to involve"]').selectOption({ label: 'Rivian' });
    await details(page).locator('input[aria-label="Role (optional)"]').first().fill('OEM');
    await details(page).getByRole('button', { name: 'Add', exact: true }).first().click();
    await expect(details(page).locator('[class*="partnerChip"]').filter({ hasText: 'Rivian' })).toBeVisible();

    // Remove it again.
    await details(page)
      .locator('[class*="partnerChip"]')
      .filter({ hasText: 'Rivian' })
      .locator('button[aria-label^="Remove"]')
      .click();
    await expect(details(page).locator('[class*="partnerChip"]').filter({ hasText: 'Rivian' })).toHaveCount(0);
  });

  test('people involvement is editable on the popover', async ({ page }) => {
    await page.goto(`/programs/${seeded.projectId}`);
    await openDetails(page, 'Integration');

    // Seeded person is visible with role; remove them.
    const kenji = details(page).locator('[class*="partnerChip"]').filter({ hasText: 'Kenji Sato' });
    await expect(kenji).toContainText('FAE');
    await kenji.locator('button[aria-label^="Remove"]').click();
    await expect(details(page).locator('[class*="partnerChip"]').filter({ hasText: 'Kenji Sato' })).toHaveCount(0);

    // Add them back with a new role via the People picker (behind the ghost "+").
    await details(page).getByRole('button', { name: 'Person to involve' }).click();
    await details(page).locator('select[aria-label="Person to involve"]').selectOption({ label: 'Kenji Sato' });
    await details(page).locator('select[aria-label="Person to involve"]')
      .locator('xpath=following-sibling::input[1]').fill('Audio lead');
    await details(page).locator('select[aria-label="Person to involve"]')
      .locator('xpath=following-sibling::button[1]').click();
    const restored = details(page).locator('[class*="partnerChip"]').filter({ hasText: 'Kenji Sato' });
    await expect(restored).toBeVisible();
    await expect(restored).toContainText('Audio lead');
  });
});

test.describe('Program phase editor', () => {
  test.describe.configure({ mode: 'serial' });

  let seeded: SeededProgram;

  test.beforeAll(async () => {
    seeded = await seedProgram();
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  // The card-DAG canvas: nodes carry only the name; everything else lives in the panel.
  const card = (page: Page, name: string) =>
    page.locator(`[data-testid="phase-card"][data-name="${name}"]`);
  const panel = (page: Page) => page.getByTestId('phase-panel');
  const saveBtn = (page: Page) => page.getByRole('button', { name: 'Save', exact: true });
  // Hydration-resilient interactions: on a cold dev-server load a click can land
  // before React attaches handlers; retry until the intended state appears.
  const openPanel = async (page: Page, name: string) => {
    await expect(async () => {
      if (!(await panel(page).isVisible())) {
        await card(page, name).click({ timeout: 2000 });
      }
      await expect(panel(page)).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 20000 });
  };
  const addPhaseOpensPanel = async (page: Page) => {
    await expect(async () => {
      if (!(await panel(page).isVisible())) {
        await page.getByRole('button', { name: 'Add phase' }).click({ timeout: 2000 });
      }
      await expect(panel(page)).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 20000 });
  };

  // Chain math shows on the rail as the constraint card's evidence line.
  const railRow = (page: Page, name: string) =>
    page.getByTestId('phase-row').filter({ has: page.locator(`a:text-is("${name}")`) });

  test('flags the seeded dead-end branch and disables Save', async ({ page }) => {
    await page.goto(`/programs/${seeded.projectId}/phases`);

    // Audio never converges on Certification — two sinks, so the graph is invalid.
    await expect(page.getByTestId('dag-errors')).toContainText('“Audio” dead-ends');
    await expect(saveBtn(page)).toBeDisabled();
  });

  test('click downstream, click upstream, CONNECT — the save persists', async ({ page }) => {
    await page.goto(`/programs/${seeded.projectId}/phases`);

    // Certification (downstream) opens the panel; Audio becomes the upstream candidate.
    await openPanel(page, 'Certification');
    await card(page, 'Audio').click();
    await panel(page).getByTestId('connect-after').click();

    // Single sink again → valid → savable.
    await expect(page.getByTestId('dag-errors')).toHaveCount(0);
    await expect(saveBtn(page)).toBeEnabled();
    await saveBtn(page).click();

    await page.waitForURL(`**/programs/${seeded.projectId}`);
    const deps = await prisma.phaseDependency.count({ where: { phaseId: seeded.phases.certification } });
    expect(deps).toBe(2);
  });

  test('a cycle is flagged live and cannot be saved', async ({ page }) => {
    await page.goto(`/programs/${seeded.projectId}/phases`);

    // Integration already depends on Bring-up; wiring Bring-up after Certification cycles.
    await openPanel(page, 'Bring-up');
    await card(page, 'Certification').click();
    await panel(page).getByTestId('connect-after').click();

    await expect(page.getByTestId('dag-errors')).toContainText('cycle');
    await expect(saveBtn(page)).toBeDisabled();
  });

  test('renames and re-forecasts (weeks) via the detail panel', async ({ page }) => {
    await page.goto(`/programs/${seeded.projectId}/phases`);

    await openPanel(page, 'Audio');
    await panel(page).getByLabel('Phase name').fill('Audio & Media');
    await panel(page).getByLabel('Forecast (weeks)').fill('3.5'); // ≈ the seeded 25 days
    await saveBtn(page).click();
    await page.waitForURL(`**/programs/${seeded.projectId}`);

    // The rail reflects the rename and the weeks-based forecast.
    const renamed = page.getByTestId('phase-row').filter({ has: page.locator('a:text-is("Audio & Media")') });
    await expect(renamed).toHaveCount(1);
    await expect(renamed).toContainText('3.6w planned'); // 25 days ≈ 3.6w
  });

  test('adds a phase after the end; removes it again', async ({ page }) => {
    await page.goto(`/programs/${seeded.projectId}/phases`);

    // Add opens the new card's panel; name it, forecast it, connect it after the end.
    await addPhaseOpensPanel(page);
    await panel(page).getByLabel('Phase name').fill('Field Trials');
    await panel(page).getByLabel('Forecast (weeks)').fill('4');
    await card(page, 'Certification').click();
    await panel(page).getByTestId('connect-after').click();

    // The END ring follows the new single sink; the graph is valid; save.
    await expect(card(page, 'Field Trials')).toHaveAttribute('title', /end phase/);
    await expect(page.getByTestId('dag-errors')).toHaveCount(0);
    await saveBtn(page).click();
    await page.waitForURL(`**/programs/${seeded.projectId}`);

    // The chain extends through the new phase: 74 + 28 ≈ 102 days — visible on the
    // constraint card's evidence line (Integration still heads the chain; rows
    // default collapsed, so expand first).
    await railRow(page, 'Integration').getByRole('button', { name: /Toggle detail/ }).click();
    await expect(railRow(page, 'Integration')).toContainText('gates ≈102 days of downstream chain work');

    // Remove it from its panel (no history yet → no confirm) and save.
    await page.goto(`/programs/${seeded.projectId}/phases`);
    await openPanel(page, 'Field Trials');
    await panel(page).getByRole('button', { name: 'Remove phase' }).click();
    await expect(page.getByTestId('dag-errors')).toHaveCount(0);
    await saveBtn(page).click();
    await page.waitForURL(`**/programs/${seeded.projectId}`);
    // rows default collapsed — expand the constraint card before reading evidence
    await railRow(page, 'Integration').getByRole('button', { name: /Toggle detail/ }).click();
    await expect(railRow(page, 'Integration')).toContainText('gates ≈74 days of downstream chain work');
  });

  test('adds a phase UPSTREAM of existing work via “before”', async ({ page }) => {
    await page.goto(`/programs/${seeded.projectId}/phases`);

    // New node; click Bring-up as the other side; connect this one BEFORE it.
    await addPhaseOpensPanel(page);
    await panel(page).getByLabel('Phase name').fill('Prep');
    await panel(page).getByLabel('Forecast (weeks)').fill('4');
    await card(page, 'Bring-up').click();
    await panel(page).getByTestId('connect-before').click();

    // Prep is now the root (Bring-up depends on it); the graph stays valid.
    await expect(page.getByTestId('dag-errors')).toHaveCount(0);
    await saveBtn(page).click();
    await page.waitForURL(`**/programs/${seeded.projectId}`);

    // The chain grew from the TOP: Prep (28d) + the old ≈74 ≈ 102 — and the
    // CONSTRAINT moves to Prep, the new first unfinished stop on the chain.
    // (rows default collapsed — expand before reading the evidence line)
    await railRow(page, 'Prep').getByRole('button', { name: /Toggle detail/ }).click();
    await expect(railRow(page, 'Prep')).toContainText('gates ≈102 days of downstream chain work');
    const bringUpDeps = await prisma.phaseDependency.count({ where: { phaseId: seeded.phases.bringUp } });
    expect(bringUpDeps).toBe(1);

    // Restore: remove Prep again.
    await page.goto(`/programs/${seeded.projectId}/phases`);
    await openPanel(page, 'Prep');
    await panel(page).getByRole('button', { name: 'Remove phase' }).click();
    await saveBtn(page).click();
    await page.waitForURL(`**/programs/${seeded.projectId}`);
    // rows default collapsed — expand the constraint card before reading evidence
    await railRow(page, 'Integration').getByRole('button', { name: /Toggle detail/ }).click();
    await expect(railRow(page, 'Integration')).toContainText('gates ≈74 days of downstream chain work');
  });
});
