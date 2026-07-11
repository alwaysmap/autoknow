import { test, expect, type Page } from '@playwright/test';
import { prisma } from './helpers/db';
import { seedProgram, type SeededProgram } from './helpers/fixtures';

// Behavioral coverage for the PhaseTrack train-line surface (spec §2.13): critical
// chain emphasis, compact read-only cards whose only affordances are the fold chevron
// and DETAILS, and the focused details surface (status update, involvement editing,
// dependencies with cycle rejection, history, phase removal).

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
  // whose notes/roles mention another phase's name (e.g. an "Audio lead" role).
  const row = (page: Page, name: string) =>
    page.getByTestId('phase-row').filter({ has: page.locator(`a:text-is("${name}")`) });
  const details = (page: Page) => page.getByTestId('phase-details');
  const openDetails = async (page: Page, name: string) => {
    await row(page, name).getByRole('button', { name: 'Details' }).click();
    await expect(details(page)).toBeVisible();
  };

  test('shows the critical chain summary and tags the constraint', async ({ page }) => {
    await page.goto(`/projects/${seeded.projectId}`);

    // Chain = Bring-up → Integration → Certification, ≈74 days of forecast work left.
    const summary = page.locator('p').filter({ hasText: 'Critical chain' });
    await expect(summary).toContainText('Bring-up');
    await expect(summary).toContainText('Integration');
    await expect(summary).toContainText('Certification');
    await expect(summary).toContainText('≈74 days remaining');

    // The first unfinished chain phase is the constraint; the off-chain phase is not.
    await expect(row(page, 'Integration').filter({ hasText: 'Constraint' })).toHaveCount(1);
    await expect(row(page, 'Audio').filter({ hasText: 'Constraint' })).toHaveCount(0);
  });

  test('cards are compact and read-only: chevron + Details are the only affordances', async ({ page }) => {
    await page.goto(`/projects/${seeded.projectId}`);

    // Done phase starts collapsed: header line only.
    const bringUp = row(page, 'Bring-up');
    await expect(bringUp).toContainText('Done');
    await expect(bringUp.getByRole('button', { name: 'Details' })).toHaveCount(0);

    // Active phase starts open: Details visible; no history or editors on the card.
    const integration = row(page, 'Integration');
    await expect(integration.getByRole('button', { name: 'Details' })).toBeVisible();
    await expect(integration.getByText('History')).toHaveCount(0);
    await expect(integration.getByText('Remove phase')).toHaveCount(0);
    await expect(integration.getByText('After', { exact: true })).toHaveCount(0);

    // Involvement is listed read-only with roles (partner + person).
    await expect(integration).toContainText('Denso');
    await expect(integration).toContainText('Kenji Sato');
    await expect(integration).toContainText('FAE');

    // The chevron folds the card away and back.
    const toggle = integration.locator('button[aria-label^="Toggle detail"]');
    await toggle.click();
    await expect(integration.getByRole('button', { name: 'Details' })).toHaveCount(0);
    await toggle.click();
    await expect(integration.getByRole('button', { name: 'Details' })).toBeVisible();
  });

  test('anticipated vs actual duration is shown per phase, in weeks', async ({ page }) => {
    await page.goto(`/projects/${seeded.projectId}`);

    // Done: planned vs took. In progress: planned vs elapsed. Not started: planned only.
    await expect(row(page, 'Bring-up')).toContainText(/[\d.]+w planned · took/);
    await expect(row(page, 'Integration')).toContainText(/[\d.]+w planned · [\d.<]+w elapsed/);
    await expect(row(page, 'Certification')).toContainText(/[\d.]+w planned/);
  });

  test('dependencies can be added and removed on the details surface', async ({ page }) => {
    await page.goto(`/projects/${seeded.projectId}`);
    await openDetails(page, 'Audio');

    // Add "after Integration" via the quiet select.
    await details(page).locator('select[aria-label="Add a dependency"]').selectOption({ label: 'Integration' });
    const chip = details(page).locator('[class*="depChip"]').filter({ hasText: 'Integration' });
    await expect(chip).toHaveCount(1);

    // Remove it again via the chip's ✕.
    await chip.locator('button[title="Remove dependency"]').click();
    await expect(details(page).locator('[class*="depChip"]').filter({ hasText: 'Integration' })).toHaveCount(0);
  });

  test('rejects a dependency that would create a cycle', async ({ page }) => {
    await page.goto(`/projects/${seeded.projectId}`);
    await openDetails(page, 'Integration');
    await expect(details(page).locator('select[aria-label="Add a dependency"]')).toBeVisible();

    // The client already filters cycle-creating options out of the select (Integration
    // is only offered "Audio"), so force the request the way a stale client could:
    // inject Certification — Integration's own descendant — and fire the change.
    await page.evaluate(
      ({ certId }) => {
        const sel = document.querySelector(
          '[data-testid="phase-details"] select[aria-label="Add a dependency"]',
        ) as HTMLSelectElement;
        const opt = document.createElement('option');
        opt.value = String(certId);
        sel.appendChild(opt);
        Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!.call(sel, String(certId));
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      },
      { certId: seeded.phases.certification },
    );

    await expect(details(page).getByText(/Rejected — .* \(cycle\)/)).toBeVisible();

    // And nothing was written: Integration still has exactly its seeded parent.
    const deps = await prisma.phaseDependency.count({ where: { phaseId: seeded.phases.integration } });
    expect(deps).toBe(1);
  });

  test('adds a phase with an "after" dependency and removes it from details', async ({ page }) => {
    await page.goto(`/projects/${seeded.projectId}`);

    await page.getByLabel('New phase name').fill('Field Trials');
    await page.getByLabel('After phase (optional)').selectOption({ label: 'Certification' });
    await page.getByRole('button', { name: 'Add phase', exact: true }).click();

    const fieldTrials = row(page, 'Field Trials');
    await expect(fieldTrials).toHaveCount(1);
    // The chain extends through the new phase: 74 + 30 (default forecast) ≈ 104 days.
    await expect(page.locator('p').filter({ hasText: 'Critical chain' })).toContainText('≈104 days remaining');

    // Remove it entirely (on the details surface, confirmed) — the chain returns.
    page.on('dialog', (d) => d.accept());
    await openDetails(page, 'Field Trials');
    await details(page).getByRole('button', { name: 'Remove phase' }).click();
    await expect(row(page, 'Field Trials')).toHaveCount(0);
    await expect(page.locator('p').filter({ hasText: 'Critical chain' })).toContainText('≈74 days remaining');
  });

  test('partner involvement is editable on the details surface', async ({ page }) => {
    await page.goto(`/projects/${seeded.projectId}`);
    await openDetails(page, 'Integration');

    // Seeded involvement is visible with its role.
    const densoChip = details(page).locator('[class*="partnerChip"]').filter({ hasText: 'Denso' });
    await expect(densoChip).toContainText('Supplier');

    // Add another partner with a role.
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

  test('people involvement is editable on the details surface', async ({ page }) => {
    await page.goto(`/projects/${seeded.projectId}`);
    await openDetails(page, 'Integration');

    // Seeded person is visible with role; remove them.
    const kenji = details(page).locator('[class*="partnerChip"]').filter({ hasText: 'Kenji Sato' });
    await expect(kenji).toContainText('FAE');
    await kenji.locator('button[aria-label^="Remove"]').click();
    await expect(details(page).locator('[class*="partnerChip"]').filter({ hasText: 'Kenji Sato' })).toHaveCount(0);

    // Add them back with a new role via the People picker.
    await details(page).locator('select[aria-label="Person to involve"]').selectOption({ label: 'Kenji Sato' });
    await details(page).locator('select[aria-label="Person to involve"]')
      .locator('xpath=following-sibling::input[1]').fill('Audio lead');
    await details(page).locator('select[aria-label="Person to involve"]')
      .locator('xpath=following-sibling::button[1]').click();
    const restored = details(page).locator('[class*="partnerChip"]').filter({ hasText: 'Kenji Sato' });
    await expect(restored).toBeVisible();
    await expect(restored).toContainText('Audio lead');
  });

  test('the details surface takes a status update inline and records history', async ({ page }) => {
    await page.goto(`/projects/${seeded.projectId}`);
    const url = page.url();

    await openDetails(page, 'Audio');

    // Same page — the surface swapped in place of the track (no dialog, no navigation).
    expect(page.url()).toBe(url);
    await expect(details(page).getByRole('heading', { name: 'Audio' })).toBeVisible();
    await expect(page.locator('dialog[open]')).toHaveCount(0);

    await details(page).locator('input[id^="phaseHillProgress-"]').fill('55');
    await details(page).locator('textarea[name="notes"]').fill('Codec samples landed; over the hill.');
    await details(page).getByRole('button', { name: 'Save Update' }).click();

    // Back on the track: the card shows the new note but NOT the history list.
    const audio = row(page, 'Audio');
    await expect(audio).toContainText('Codec samples landed; over the hill.', { timeout: 10000 });
    await expect(audio.getByText('History')).toHaveCount(0);

    // The history (with the prior update) lives on the details surface.
    await openDetails(page, 'Audio');
    await expect(details(page).getByText('History', { exact: true })).toBeVisible();
    await expect(details(page).locator('[class*="historyItem"]')).toHaveCount(2);
  });
});
