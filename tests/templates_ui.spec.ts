import { test, expect } from './helpers/e2e';
import { prisma } from './helpers/db';

// The /templates authoring surface (PHASE_TEMPLATES_PLAN §6): built-ins listed and
// clone-only; user templates fully editable via the shared card-DAG editor (the same
// surface that edits live program layouts) — live DAG validation from templateDag,
// atomic whole-graph save, and the result usable from projects/new.

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

  test('clones a built-in into an editable copy on the card-DAG editor', async ({ page }) => {
    await page.goto('/templates');
    await page.getByTestId('template-row')
      .filter({ hasText: 'Digital Key' })
      .getByRole('button', { name: 'Clone' }).click();

    await page.waitForURL(/\/templates\/\d+\/edit/);
    await expect(page.getByLabel('Template name')).toHaveValue('Digital Key (copy)');
    await expect(page.getByTestId('phase-card')).toHaveCount(3);
    // A valid clone shows no validation errors.
    await expect(page.getByTestId('dag-errors')).toHaveCount(0);
  });

  // The SECOND clone is the regression (autoknow-qru). `ProgramTemplate` is unique on
  // (name, isBuiltIn) and the copy used to be named `${source.name} (copy)` flat, so
  // cloning anything twice threw P2002 out of the server action — which fails before its
  // redirect, leaving the user on /templates with a generic error and no template. Runs
  // after the clone above, whose "Digital Key (copy)" is exactly what this must not
  // collide with. `createTemplate` had the same shape with a hardcoded 'New template',
  // so both halves of the pattern are asserted here (AGENTS lesson 7).
  test('cloning twice, and creating twice, pick the next free name instead of failing', async ({ page }) => {
    await page.goto('/templates');
    await page.getByTestId('template-row')
      .filter({ hasText: 'Digital Key' }).first()
      .getByRole('button', { name: 'Clone' }).click();

    await page.waitForURL(/\/templates\/\d+\/edit/);
    await expect(page.getByLabel('Template name')).toHaveValue('Digital Key (copy 2)');

    await page.goto('/templates');
    await page.getByRole('button', { name: 'New template' }).click();
    await page.waitForURL(/\/templates\/\d+\/edit/);
    const first = await page.getByLabel('Template name').inputValue();

    await page.goto('/templates');
    await page.getByRole('button', { name: 'New template' }).click();
    await page.waitForURL(/\/templates\/\d+\/edit/);
    // Left unnamed on purpose: two provisional templates must be able to coexist, which
    // is the state the constant name made unreachable.
    await expect(page.getByLabel('Template name')).not.toHaveValue(first);
  });

  test('authors a new template on the card-DAG editor with live validation', async ({ page }) => {
    const card = (name: string) => page.locator(`[data-testid="phase-card"][data-name="${name}"]`);
    const panel = page.getByTestId('phase-panel');

    await page.goto('/templates');
    await page.getByRole('button', { name: 'New template' }).click();
    await page.waitForURL(/\/templates\/\d+\/edit/);

    // Name it (template meta has its own Save; the canvas Save is disabled while empty).
    await page.getByLabel('Template name').fill('Cluster Display Bring-up');
    await page.getByRole('button', { name: 'Save', exact: true }).first().click();
    await expect(page.getByLabel('Template name')).toHaveValue('Cluster Display Bring-up');

    // Empty template → validation demands at least one phase.
    await expect(page.getByTestId('dag-errors')).toBeVisible();

    // First phase via the detail panel — a single node is its own valid end.
    await page.getByRole('button', { name: 'Add phase' }).click();
    await panel.getByLabel('Phase name').fill('Kickoff');
    await panel.getByLabel('Forecast (weeks)').fill('2');
    await panel.getByLabel('Lead role').selectOption('Google');
    await expect(page.getByTestId('dag-errors')).toHaveCount(0);

    // Second phase; connect it after Kickoff (click upstream → CONNECT) — still valid,
    // and the END ring rides on the derived sink.
    await page.getByRole('button', { name: 'Add phase' }).click();
    await panel.getByLabel('Phase name').fill('Ship');
    await panel.getByLabel('Forecast (weeks)').fill('4');
    await card('Kickoff').click();
    await panel.getByTestId('connect-after').click();
    await expect(card('Ship')).toHaveAttribute('title', /end phase/);
    await expect(page.getByTestId('dag-errors')).toHaveCount(0);

    // A dead-end branch is flagged with the offending phase, then clears on remove.
    await page.getByRole('button', { name: 'Add phase' }).click();
    await panel.getByLabel('Phase name').fill('Stray');
    await expect(page.getByTestId('dag-errors')).toContainText('Stray');
    await panel.getByRole('button', { name: 'Remove phase' }).click();
    await expect(page.getByTestId('dag-errors')).toHaveCount(0);

    // Atomic whole-graph save; the layout persists. The completion signal must NOT be
    // "disabled" alone — the button is also disabled (as "Saving…") mid-flight, before
    // the transaction commits. "Save" text + disabled = transition done AND draft
    // clean against the refreshed server state.
    const canvasSave = page.getByTestId('dag-save');
    await canvasSave.click();
    await expect(canvasSave).toHaveText('Save', { timeout: 10000 });
    await expect(canvasSave).toBeDisabled();
    await expect(page.getByTestId('save-error')).toHaveCount(0);
    await expect(page.getByTestId('phase-card')).toHaveCount(2);
    const saved = await prisma.programTemplate.findFirst({
      where: { name: 'Cluster Display Bring-up' },
      include: { phases: { include: { dependsOn: true } } },
    });
    expect(saved!.phases).toHaveLength(2);
    const ship = saved!.phases.find((p) => p.name === 'Ship')!;
    expect(ship.isEndPhase).toBe(true); // derived: the unique sink
    expect(ship.durationWeeks).toBe(4);
    expect(ship.dependsOn).toHaveLength(1);
  });

  test('drag-to-connect: dropping one card onto another creates the edge', async ({ page }) => {
    const card = (name: string) => page.locator(`[data-testid="phase-card"][data-name="${name}"]`);
    const panel = page.getByTestId('phase-panel');

    await page.goto('/templates');
    await page.getByRole('button', { name: 'New template' }).click();
    await page.waitForURL(/\/templates\/\d+\/edit/);
    await page.getByLabel('Template name').fill('Drag Connect Fixture');
    await page.getByRole('button', { name: 'Save', exact: true }).first().click();

    await page.getByRole('button', { name: 'Add phase' }).click();
    await panel.getByLabel('Phase name').fill('Base');
    await page.getByRole('button', { name: 'Add phase' }).click();
    await panel.getByLabel('Phase name').fill('Cert');

    // Two disconnected roots → the validator objects. Drag Cert onto Base: the
    // dragged node comes AFTER the drop target. Regression: the dragged card used
    // to swallow the drop hit-test (elementFromPoint found the ghost itself), so
    // the edge silently never appeared.
    const from = (await card('Cert').boundingBox())!;
    const to = (await card('Base').boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
    await page.mouse.up();

    await expect(card('Cert')).toHaveAttribute('title', /end phase/);
    await expect(page.getByTestId('dag-errors')).toHaveCount(0);
  });

  test('the authored template is offered by project creation', async ({ page }) => {
    await page.goto('/programs/new');
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
