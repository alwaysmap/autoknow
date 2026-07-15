import { test, expect } from '@playwright/test';
import { prisma } from './helpers/db';
import { wipeAll } from './helpers/fixtures';

test.describe('Admin and Maintenance Operations', () => {
  test.describe.configure({ mode: 'serial' });

  let personId: number;
  let projectId: number;
  let fordId: number;

  test.beforeAll(async () => {
    // Clear and seed clean tables
    await wipeAll();

    const ford = await prisma.partner.create({
      data: { name: 'Ford', type: { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } } }
    });
    fordId = ford.id;

    const waymo = await prisma.partner.create({
      data: { name: 'Waymo', type: { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } } }
    });


    // Create project
    const project = await prisma.project.create({
      data: { name: 'Waymo Autonomous Trucking', partnerId: waymo.id }
    });
    projectId = project.id;

    // Create person starting at Ford, currently at Waymo
    const person = await prisma.person.create({
      data: {
        name: 'Bob Miller',
        email: 'bmiller@example.com',
        currentPartnerId: waymo.id,
        notes: 'Platform engineer'
      }
    });
    personId = person.id;

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

  test('should allow moving a person to a different company', async ({ page }) => {
    const person = await prisma.person.findFirst({ where: { name: 'Bob Miller' } });
    const ford = await prisma.partner.findFirst({ where: { name: 'Ford' } });
    await page.goto(`/people/${person?.id}`);

    // Verify Bob starts at Waymo
    await expect(page.locator('body')).toContainText('Waymo');

    // Fill the move company form
    await page.selectOption('select[name="newPartnerId"]', ford?.id.toString() || '');
    await page.fill('input[name="newRole"]', 'Lead Systems Architect');
    await page.fill('input[name="startDate"]', '2026-06-01');
    await page.click('button:has-text("Move Partner")');

    // Verify updated details
    await expect(page.locator('body')).toContainText('Ford');
    await expect(page.locator('body')).toContainText('Lead Systems Architect');
  });

  test('should allow copy/duplicating a person profile', async ({ page }) => {
    const person = await prisma.person.findFirst({ where: { name: 'Bob Miller' } });
    await page.goto(`/people/${person?.id}`);

    // Submit duplicate person form
    await page.fill('input[name="copyEmail"]', 'bmiller.copy@example.com');
    await page.click('button:has-text("Copy Profile")');

    // Should redirect to the new person's details page
    await page.waitForURL(/\/people\/\d+/);
    await expect(page.locator('h1')).toContainText('Bob Miller');
    await expect(page.locator('body')).toContainText('bmiller.copy@example.com');
  });

  test('should allow archiving and deleting a project', async ({ page }) => {
    const project = await prisma.project.findFirst({ where: { name: 'Waymo Autonomous Trucking' } });
    await page.goto(`/programs/${project?.id}`);

    // Archive project
    await page.getByRole('button', { name: 'Archive', exact: true }).click();
    await expect(page.locator('body')).toContainText('[Archived]');

    // Delete project with confirmation name typing
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.fill('input[id="confirmProjectName"]', 'Waymo Autonomous Trucking');
    await page.click('button:has-text("Permanently Delete Project")');

    // Verify redirected to dashboard and project is gone
    await page.waitForURL('/');
    await expect(page.locator('body')).not.toContainText('Waymo Autonomous Trucking');
  });
});
