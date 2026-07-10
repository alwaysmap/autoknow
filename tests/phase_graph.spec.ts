import { test, expect, type Page } from '@playwright/test';
import { prisma } from './helpers/db';
import { seedProgram, type SeededProgram } from './helpers/fixtures';

// Behavioral coverage for the PhaseGraph rail (spec §2.13): critical chain emphasis,
// three-state row cycling, dependency editing with cycle rejection, inline phase CRUD,
// and per-phase partner involvement.

test.describe('PhaseGraph rail', () => {
  test.describe.configure({ mode: 'serial' });

  let seeded: SeededProgram;

  test.beforeAll(async () => {
    seeded = await seedProgram();
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  const row = (page: Page, name: string) => page.getByTestId('phase-row').filter({ hasText: name });

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

  test('rows cycle collapsed → minimal → expanded, Done starting collapsed', async ({ page }) => {
    await page.goto(`/projects/${seeded.projectId}`);

    // Done phase starts collapsed: no hill editor visible.
    const bringUp = row(page, 'Bring-up');
    await expect(bringUp).toContainText('Done');
    await expect(bringUp.getByRole('button', { name: 'Update', exact: true })).toHaveCount(0);

    // Active phase starts minimal: hill editor visible, management controls hidden.
    const integration = row(page, 'Integration');
    await expect(integration.getByRole('button', { name: 'Update', exact: true })).toBeVisible();
    await expect(integration.getByText('Remove phase')).toHaveCount(0);

    // Tap the header: minimal → expanded (dependencies + remove appear).
    const toggle = integration.locator('button[aria-label^="Row detail"]');
    await toggle.click();
    await expect(integration.getByText('Remove phase')).toBeVisible();
    await expect(integration.getByText('After', { exact: true })).toBeVisible();
    await expect(integration.getByText('Enables')).toBeVisible();

    // expanded → collapsed (everything folds to the one quiet line).
    await toggle.click();
    await expect(integration.getByRole('button', { name: 'Update', exact: true })).toHaveCount(0);

    // collapsed → minimal again.
    await toggle.click();
    await expect(integration.getByRole('button', { name: 'Update', exact: true })).toBeVisible();
  });

  test('dependencies can be added and removed from the expanded row', async ({ page }) => {
    await page.goto(`/projects/${seeded.projectId}`);

    const audio = row(page, 'Audio');
    await audio.locator('button[aria-label^="Row detail"]').click(); // minimal -> expanded

    // Add "after Integration" via the quiet select.
    await audio.locator('select[aria-label="Add a dependency"]').selectOption({ label: 'Integration' });
    const chip = audio.locator('[class*="depChip"]').filter({ hasText: 'Integration' });
    await expect(chip).toHaveCount(1);

    // Remove it again via the chip's ✕.
    await chip.locator('button[title="Remove dependency"]').click();
    await expect(audio.locator('[class*="depChip"]').filter({ hasText: 'Integration' })).toHaveCount(0);
  });

  test('rejects a dependency that would create a cycle', async ({ page }) => {
    await page.goto(`/projects/${seeded.projectId}`);

    const integration = row(page, 'Integration');
    await integration.locator('button[aria-label^="Row detail"]').click(); // minimal -> expanded
    await expect(integration.locator('select[aria-label="Add a dependency"]')).toBeVisible();

    // The client already filters cycle-creating options out of the select (Integration
    // is only offered "Audio"), so force the request the way a stale client could:
    // inject Certification — Integration's own descendant — and fire the change.
    await page.evaluate(
      ({ certId }) => {
        const rows = [...document.querySelectorAll('[data-testid="phase-row"]')];
        const target = rows.find((r) => r.querySelector('a')?.textContent?.trim() === 'Integration')!;
        const sel = target.querySelector('select[aria-label="Add a dependency"]') as HTMLSelectElement;
        const opt = document.createElement('option');
        opt.value = String(certId);
        sel.appendChild(opt);
        Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!.call(sel, String(certId));
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      },
      { certId: seeded.phases.certification },
    );

    await expect(integration.getByText(/Rejected — .* \(cycle\)/)).toBeVisible();

    // And nothing was written: Integration still has exactly its seeded parent.
    const deps = await prisma.phaseDependency.count({ where: { phaseId: seeded.phases.integration } });
    expect(deps).toBe(1);
  });

  test('adds a phase with an "after" dependency and removes it entirely', async ({ page }) => {
    await page.goto(`/projects/${seeded.projectId}`);

    await page.getByLabel('New phase name').fill('Field Trials');
    await page.getByLabel('After phase (optional)').selectOption({ label: 'Certification' });
    await page.getByRole('button', { name: 'Add phase', exact: true }).click();

    const fieldTrials = row(page, 'Field Trials');
    await expect(fieldTrials).toHaveCount(1);
    // The chain extends through the new phase: 74 + 30 (default forecast) ≈ 104 days.
    await expect(page.locator('p').filter({ hasText: 'Critical chain' })).toContainText('≈104 days remaining');

    // Remove it entirely (confirmed) — the chain returns to its previous length.
    page.on('dialog', (d) => d.accept());
    await fieldTrials.locator('button[aria-label^="Row detail"]').click(); // minimal -> expanded
    await fieldTrials.getByRole('button', { name: 'Remove phase' }).click();
    await expect(row(page, 'Field Trials')).toHaveCount(0);
    await expect(page.locator('p').filter({ hasText: 'Critical chain' })).toContainText('≈74 days remaining');
  });

  test('partner involvement is editable per phase', async ({ page }) => {
    await page.goto(`/projects/${seeded.projectId}`);

    const integration = row(page, 'Integration');
    await integration.locator('button[aria-label^="Row detail"]').click(); // -> expanded

    // Seeded involvement is visible with its role.
    const densoChip = integration.locator('[class*="partnerChip"]').filter({ hasText: 'Denso' });
    await expect(densoChip).toContainText('Supplier');

    // Add another partner with a role.
    await integration.locator('select[aria-label="Partner to involve"]').selectOption({ label: 'Rivian' });
    await integration.locator('input[aria-label="Role (optional)"]').fill('OEM');
    await integration.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(integration.locator('[class*="partnerChip"]').filter({ hasText: 'Rivian' })).toBeVisible();

    // Remove it again.
    await integration
      .locator('[class*="partnerChip"]')
      .filter({ hasText: 'Rivian' })
      .locator('button[aria-label^="Remove"]')
      .click();
    await expect(integration.locator('[class*="partnerChip"]').filter({ hasText: 'Rivian' })).toHaveCount(0);
  });
});
