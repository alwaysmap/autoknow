import { test, expect } from '@playwright/test';
import { prisma } from './helpers/db';
import { wipeAll } from './helpers/fixtures';

test.describe('Admin and Maintenance Operations', () => {
  test.describe.configure({ mode: 'serial' });


  test.beforeAll(async () => {
    // Clear and seed clean tables
    await wipeAll();

    const ford = await prisma.partner.create({
      data: { name: 'Ford', type: { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } }, region: { connectOrCreate: { where: { name: 'AMER' }, create: { name: 'AMER' } } } }
    });

    const waymo = await prisma.partner.create({
      data: { name: 'Waymo', type: { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } }, region: { connectOrCreate: { where: { name: 'AMER' }, create: { name: 'AMER' } } } }
    });


    // Create project
    await prisma.project.create({
      data: { name: 'Waymo Autonomous Trucking', partnerId: waymo.id }
    });

    // Create person starting at Ford, currently at Waymo
    const person = await prisma.person.create({
      data: {
        name: 'Bob Miller',
        email: 'bmiller@example.com',
        currentPartnerId: waymo.id,
        notes: 'Platform engineer'
      }
    });

    // Bob worked at Ford from 2024 to 2025
    await prisma.personAffiliation.create({
      data: {
        personId: person.id,
        partnerId: ford.id,
        role: 'Junior Engineer',
        startDate: new Date('2024-01-01T00:00:00Z'),
        endDate: new Date('2025-12-31T23:59:59Z')
      }
    });

    // Bob works at Waymo from 2026 to Present
    await prisma.personAffiliation.create({
      data: {
        personId: person.id,
        partnerId: waymo.id,
        role: 'Senior Engineer',
        startDate: new Date('2026-01-01T00:00:00Z')
      }
    });
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  // Maintenance lives behind the title kebab now — open the menu item (hydration-
  // guarded), then work in its dialog.
  const viaPersonKebab = async (page: import('@playwright/test').Page, label: string) => {
    const item = page.getByRole('button', { name: label, exact: true });
    await expect(async () => {
      if (!(await item.isVisible())) await page.getByTestId('kebab-menu').click({ timeout: 2000 });
      await expect(item).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 20000 });
    await item.click();
  };

  test('should allow moving a person to a different company', async ({ page }) => {
    const person = await prisma.person.findFirst({ where: { name: 'Bob Miller' } });
    const ford = await prisma.partner.findFirst({ where: { name: 'Ford' } });
    await page.goto(`/people/${person?.id}`);

    // Verify Bob starts at Waymo
    await expect(page.locator('body')).toContainText('Waymo');

    await viaPersonKebab(page, 'Move to Different Company');
    const dialog = page.locator('dialog[open]');
    await dialog.locator('select[name="newPartnerId"]').selectOption(ford?.id.toString() || '');
    await dialog.locator('input[name="newRole"]').fill('Lead Systems Architect');
    await dialog.locator('input[name="startDate"]').fill('2026-06-01');
    await dialog.locator('button:has-text("Move Partner")').click();

    // Verify updated details
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await expect(page.locator('body')).toContainText('Ford');
    await expect(page.locator('body')).toContainText('Lead Systems Architect');
  });

  test('should allow copy/duplicating a person profile', async ({ page }) => {
    const person = await prisma.person.findFirst({ where: { name: 'Bob Miller' } });
    await page.goto(`/people/${person?.id}`);

    await viaPersonKebab(page, 'Copy Person Profile');
    const dialog = page.locator('dialog[open]');
    await dialog.locator('input[name="copyEmail"]').fill('bmiller.copy@example.com');
    await dialog.locator('button:has-text("Copy Profile")').click();

    // Should redirect to the new person's details page
    await page.waitForURL(/\/people\/\d+/);
    await expect(page.locator('h1')).toContainText('Bob Miller');
    await expect(page.locator('body')).toContainText('bmiller.copy@example.com');
  });

  test('program lifecycle: cancel and reactivate from the kebab, visible in filters', async ({ page }) => {
    const project = await prisma.project.findFirst({ where: { name: 'Waymo Autonomous Trucking' } });
    await page.goto(`/programs/${project?.id}`);

    const viaKebab = async (label: string) => {
      const item = page.getByRole('button', { name: label, exact: true });
      await expect(async () => {
        if (!(await item.isVisible())) await page.getByTestId('kebab-menu').click({ timeout: 2000 });
        await expect(item).toBeVisible({ timeout: 1500 });
      }).toPass({ timeout: 20000 });
      await item.click();
    };

    // Cancel — an explicit lifecycle fact, set in the UI.
    await viaKebab('Mark cancelled');
    await expect.poll(async () =>
      (await prisma.project.findUnique({ where: { id: project!.id } }))?.lifecycle,
    { timeout: 10000 }).toBe('cancelled');

    // The programs table derives Status=Cancelled from it.
    await page.goto('/programs');
    const row = page.locator('tr').filter({ hasText: 'Waymo Autonomous Trucking' });
    await expect(row).toContainText('Cancelled');

    // Reactivate (also leaves the project live for the archive/delete test below).
    await page.goto(`/programs/${project?.id}`);
    await viaKebab('Reactivate');
    await expect.poll(async () =>
      (await prisma.project.findUnique({ where: { id: project!.id } }))?.lifecycle,
    { timeout: 10000 }).toBe('active');
  });

  test('should allow archiving and deleting a project', async ({ page }) => {
    const project = await prisma.project.findFirst({ where: { name: 'Waymo Autonomous Trucking' } });
    await page.goto(`/programs/${project?.id}`);

    // Header actions live in the ⋯ menu now; open it (hydration-guarded), then act.
    const viaKebab = async (label: string) => {
      const item = page.getByRole('button', { name: label, exact: true });
      await expect(async () => {
        if (!(await item.isVisible())) await page.getByTestId('kebab-menu').click({ timeout: 2000 });
        await expect(item).toBeVisible({ timeout: 1500 });
      }).toPass({ timeout: 20000 });
      await item.click();
    };

    // Archive project
    await viaKebab('Archive');
    await expect(page.locator('body')).toContainText('[Archived]');

    // Delete project with confirmation name typing
    await viaKebab('Delete');
    await page.fill('input[id="confirmProjectName"]', 'Waymo Autonomous Trucking');
    await page.click('button:has-text("Permanently Delete Project")');

    // Verify redirected to dashboard and project is gone
    await page.waitForURL('/');
    await expect(page.locator('body')).not.toContainText('Waymo Autonomous Trucking');
  });
});
