import { test, expect } from '@playwright/test';
import { prisma } from './helpers/db';

// The /templates authoring surface (PHASE_TEMPLATES_PLAN §6): built-ins listed and
// clone-only; user templates fully editable — phase CRUD via <dialog>, live DAG
// validation from templateDag, and the result usable from projects/new.

test.describe('Program template authoring', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    // Built-ins seed on demand; user templates start clean.
    await prisma.programTemplate.deleteMany({ where: { isBuiltIn: false } });
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test('lists built-ins with phase counts; built-ins are clone-only', async ({ page }) => {
    await page.goto('/templates');

    const aaos = page.getByTestId('template-row').filter({ hasText: 'AAOS Bring-up (chipset → GBI)' });
    await expect(aaos).toHaveCount(1);
    await expect(aaos).toContainText('15');
    await expect(aaos).toContainText('Built-in');
    await expect(aaos.getByRole('button', { name: 'Clone' })).toBeVisible();
    await expect(aaos.getByRole('button', { name: 'Delete' })).toHaveCount(0);
  });

  test('clones a built-in into an editable copy', async ({ page }) => {
    await page.goto('/templates');
    await page.getByTestId('template-row')
      .filter({ hasText: 'Digital Key' })
      .getByRole('button', { name: 'Clone' }).click();

    await page.waitForURL(/\/templates\/\d+\/edit/);
    await expect(page.getByLabel('Template name')).toHaveValue('Digital Key (copy)');
    await expect(page.getByTestId('phase-template-row')).toHaveCount(3);
    // A valid clone shows no validation errors.
    await expect(page.getByTestId('dag-errors')).toHaveCount(0);
  });

  test('authors a new template with live DAG validation', async ({ page }) => {
    await page.goto('/templates');
    await page.getByRole('button', { name: 'New template' }).click();
    await page.waitForURL(/\/templates\/\d+\/edit/);

    // Name it.
    await page.getByLabel('Template name').fill('Cluster Display Bring-up');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByLabel('Template name')).toHaveValue('Cluster Display Bring-up');

    // Empty template → validation demands phases/end phase.
    await expect(page.getByTestId('dag-errors')).toBeVisible();

    // Add a first phase (not the end yet) — banner asks for an end phase.
    await page.getByRole('button', { name: 'Add phase' }).click();
    const dialog = page.locator('dialog[open]');
    await dialog.locator('input[name="name"]').fill('Kickoff');
    await dialog.locator('input[name="durationWeeks"]').fill('2');
    await dialog.getByRole('button', { name: 'Save phase' }).click();
    await expect(page.getByTestId('phase-template-row')).toHaveCount(1);
    await expect(page.getByTestId('dag-errors')).toContainText('end phase');

    // Add the end phase depending on Kickoff — the DAG becomes valid.
    await page.getByRole('button', { name: 'Add phase' }).click();
    await dialog.locator('input[name="name"]').fill('Ship');
    await dialog.locator('input[name="durationWeeks"]').fill('4');
    await dialog.locator('input[name="isEndPhase"]').check();
    await dialog.locator('select[name="dependsOn"]').selectOption({ label: 'Kickoff' });
    await dialog.getByRole('button', { name: 'Save phase' }).click();
    await expect(page.getByTestId('phase-template-row')).toHaveCount(2);
    await expect(page.getByTestId('dag-errors')).toHaveCount(0);

    // A dead-end branch is flagged with the offending phase, then clears on delete.
    await page.getByRole('button', { name: 'Add phase' }).click();
    await dialog.locator('input[name="name"]').fill('Stray');
    await dialog.getByRole('button', { name: 'Save phase' }).click();
    await expect(page.getByTestId('dag-errors')).toContainText('Stray');
    page.on('dialog', (d) => d.accept());
    await page.getByTestId('phase-template-row').filter({ hasText: 'Stray' })
      .getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByTestId('dag-errors')).toHaveCount(0);
  });

  test('the authored template is offered by project creation', async ({ page }) => {
    await page.goto('/projects/new');
    await expect(
      page.locator('select[name="template"] option', { hasText: 'Cluster Display Bring-up' }),
    ).toHaveCount(1);
  });

  test('user templates can be deleted from the list', async ({ page }) => {
    await page.goto('/templates');
    page.on('dialog', (d) => d.accept());
    const mine = page.getByTestId('template-row').filter({ hasText: 'Cluster Display Bring-up' });
    await mine.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByTestId('template-row').filter({ hasText: 'Cluster Display Bring-up' })).toHaveCount(0);
    // Built-ins are untouched.
    await expect(page.getByTestId('template-row').filter({ hasText: 'Digital Key (copy)' })).toHaveCount(1);
  });
});
