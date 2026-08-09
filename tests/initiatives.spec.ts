import { test, expect, pickCombobox } from './helpers/e2e';
import { prisma } from './helpers/db';
import { wipeAll } from './helpers/fixtures';

// Initiatives end-to-end (gh-286 parts d/e): create → add partner (copy instantiated)
// → the copy's user-visible home under the initiative (no chain section, no
// phase-structure editing) → /programs/[id] redirect → remove keeps history.
test.describe('Initiatives', () => {
  test.describe.configure({ mode: 'serial' });

  let bmwId: number;

  test.beforeAll(async () => {
    await wipeAll();
    const bmw = await prisma.partner.create({
      data: { name: 'BMW', type: { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } }, region: { connectOrCreate: { where: { name: 'EMEA' }, create: { name: 'EMEA' } } } },
    });
    bmwId = bmw.id;
    // A source template to snapshot: Design → Ship.
    const t = await prisma.programTemplate.create({ data: { name: 'AAOS feature rollout' } });
    const design = await prisma.phaseTemplate.create({ data: { templateId: t.id, name: 'Design', durationWeeks: 2, sortOrder: 0 } });
    const ship = await prisma.phaseTemplate.create({ data: { templateId: t.id, name: 'Ship', durationWeeks: 2, sortOrder: 1, isEndPhase: true } });
    await prisma.phaseTemplateDep.create({ data: { phaseTemplateId: ship.id, dependsOnId: design.id } });
  });

  test.afterAll(async () => {
    await wipeAll();
  });

  test('create → add a partner → copy lives under the initiative → remove keeps history', async ({ page }) => {
    await page.goto('/initiatives/new');

    // Hydration-guarded first interaction (the suite's #1 flake source otherwise).
    const nameField = page.getByLabel(/initiative name/i);
    await expect(async () => {
      await nameField.fill('Gemini built-in across the fleet');
      await expect(nameField).toHaveValue('Gemini built-in across the fleet', { timeout: 1500 });
    }).toPass({ timeout: 20000 });
    await pickCombobox(page.locator('form'), 'Program Template (Critical Chain DAG)', 'AAOS feature rollout');
    await page.getByLabel(/target month/i).fill('2026-12');
    await page.getByRole('button', { name: /create initiative/i }).click();

    // Lands on the initiative's own page; the snapshot is private (source untouched).
    await expect(page).toHaveURL(/\/initiatives\/\d+$/, { timeout: 15000 });
    await expect(page.locator('h1')).toContainText('Gemini built-in across the fleet');
    const initiative = await prisma.initiative.findFirstOrThrow();
    const source = await prisma.programTemplate.findFirstOrThrow({ where: { name: 'AAOS feature rollout' } });
    expect(initiative.templateId).not.toBe(source.id);

    // Add BMW from the initiative page via the bulk-add table's per-row Add (part f
    // replaced the single-pick combobox). Retry-safe: the action skips active members.
    const membersSection = page.locator('section', { has: page.locator('#partners') });
    await expect(async () => {
      const rowAdd = page.getByRole('button', { name: 'Add BMW to this initiative' });
      if (await rowAdd.isVisible()) await rowAdd.click({ timeout: 2000 });
      await expect(membersSection.getByRole('link', { name: 'BMW', exact: true })).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 20000 });

    // The member row appears with completion + status, and the copy exists.
    await expect(page.locator('body')).toContainText('On track');
    const copy = await prisma.project.findFirstOrThrow({
      where: { initiativeId: initiative.id },
      include: { phases: true },
    });
    expect(copy.partnerId).toBe(bmwId);
    expect(copy.sopDate).not.toBeNull(); // inherited the initiative default
    // The FULL phase graph came with it (gh-286 part i): both snapshot phases and
    // the Design → Ship dependency edge, instantiated per copy.
    expect(copy.phases.map((p) => p.name).sort()).toEqual(['Design', 'Ship']);
    expect(
      await prisma.phaseDependency.count({ where: { phaseId: { in: copy.phases.map((p) => p.id) } } }),
    ).toBe(1);

    // The copy's user-visible home: under the initiative, chainless, structure locked.
    await page.goto(`/initiatives/${initiative.id}/${copy.id}`);
    await expect(page.locator('h1')).toContainText('Gemini built-in across the fleet — BMW');
    await expect(page.locator('body')).not.toContainText('Critical Chain');
    await expect(page.locator('body')).not.toContainText('Edit phases');
    // The step rail still shows the steps themselves.
    await expect(page.locator('body')).toContainText('Design');
    await expect(page.locator('body')).toContainText('Ship');

    // The program-shaped URL REDIRECTS here (persisted citations keep resolving).
    await page.goto(`/programs/${copy.id}`);
    await expect(page).toHaveURL(`/initiatives/${initiative.id}/${copy.id}`);

    // Remove: the join flips, the copy is cancelled and KEPT.
    await page.goto(`/initiatives/${initiative.id}`);
    const removeButton = page.getByRole('button', { name: /remove/i }).first();
    await expect(async () => {
      if (await removeButton.isVisible()) await removeButton.click({ timeout: 2000 });
      await expect(page.getByRole('button', { name: /remove/i })).toHaveCount(0, { timeout: 2000 });
    }).toPass({ timeout: 20000 });
    const membership = await prisma.initiativePartner.findFirstOrThrow({ where: { initiativeId: initiative.id, partnerId: bmwId } });
    expect(membership.status).toBe('removed');
    const kept = await prisma.project.findUniqueOrThrow({ where: { id: copy.id } });
    expect(kept.lifecycle).toBe('cancelled');
  });

  test('funnel-filter the add table, bulk-add the filtered set — members and copies exist', async ({ page }) => {
    // Two APAC partners (one with product-carrying device programs) beside the EMEA
    // rows the first test left behind, so the region funnel has something to exclude.
    const oem = { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } };
    const apac = { connectOrCreate: { where: { name: 'APAC' }, create: { name: 'APAC' } } };
    const toyota = await prisma.partner.create({ data: { name: 'Toyota', type: oem, region: apac } });
    await prisma.project.create({ data: { name: 'Corolla', partnerId: toyota.id, hasGas: true, hasDigitalKey: true } });
    const honda = await prisma.partner.create({ data: { name: 'Honda', type: oem, region: apac } });
    const initiative = await prisma.initiative.findFirstOrThrow();

    await page.goto(`/initiatives/${initiative.id}`);

    // The Products column derives from Toyota's real programs (GAS + Digital Key).
    const toyotaRow = page.locator('tr', { has: page.getByRole('link', { name: 'Toyota', exact: true }) });
    await expect(toyotaRow).toContainText('GAS');
    await expect(toyotaRow).toContainText('Digital Key');

    // Open the region funnel and pick APAC — hydration-guarded first interaction.
    const apacOption = page.getByRole('checkbox', { name: 'APAC' });
    await expect(async () => {
      if (!(await apacOption.isVisible())) await page.getByTestId('filter-regionName').click({ timeout: 2000 });
      await expect(apacOption).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 20000 });
    await apacOption.check();

    // The batch button counts exactly the visible (filtered) rows: Toyota + Honda.
    const bulkButton = page.getByRole('button', { name: 'Add 2 filtered partners' });
    await expect(bulkButton).toBeVisible();

    // Bulk-add them; both land in the members table. Retry-safe: adds skip members.
    const membersSection = page.locator('section', { has: page.locator('#partners') });
    await expect(async () => {
      if (await bulkButton.isVisible()) await bulkButton.click({ timeout: 2000 });
      await expect(membersSection.getByRole('link', { name: 'Toyota', exact: true })).toBeVisible({ timeout: 2000 });
      await expect(membersSection.getByRole('link', { name: 'Honda', exact: true })).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 20000 });

    // The memberships are active and each got a fresh copy of the snapshot, named
    // for the pair and carrying the initiative's default target (no month override
    // was set on the batch).
    for (const partner of [toyota, honda]) {
      const membership = await prisma.initiativePartner.findFirstOrThrow({ where: { initiativeId: initiative.id, partnerId: partner.id } });
      expect(membership.status).toBe('active');
      const copy = await prisma.project.findFirstOrThrow({ where: { initiativeId: initiative.id, partnerId: partner.id, lifecycle: 'active' } });
      expect(copy.name).toBe(`${initiative.name} — ${partner.name}`);
      expect(copy.sopDate).not.toBeNull();
    }
  });
});
