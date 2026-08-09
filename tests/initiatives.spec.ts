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

    // Add BMW from the initiative page (single-pick complement of part f's bulk add).
    await pickCombobox(page.locator('form', { has: page.getByRole('button', { name: /add partner/i }) }), 'Add partner', 'BMW');
    await page.getByRole('button', { name: /add partner/i }).click();

    // The member row appears with completion + status, and the copy exists.
    await expect(page.getByRole('link', { name: 'BMW', exact: true })).toBeVisible({ timeout: 15000 });
    await expect(page.locator('body')).toContainText('On track');
    const copy = await prisma.project.findFirstOrThrow({ where: { initiativeId: initiative.id } });
    expect(copy.partnerId).toBe(bmwId);
    expect(copy.sopDate).not.toBeNull(); // inherited the initiative default

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
});
