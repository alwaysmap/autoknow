import { test, expect } from '@playwright/test';
import { prisma } from './helpers/db';
import { wipeAll } from './helpers/fixtures';

test.describe('People and Biographical History', () => {
  test.describe.configure({ mode: 'serial' });

  let personId: number;

  test.beforeAll(async () => {
    // Clean tables
    await wipeAll();
    
    // Clean new Person / Affiliation tables
    await wipeAll();

    // Setup partners
    const ford = await prisma.partner.create({
      data: { name: 'Ford', type: { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } }, region: { connectOrCreate: { where: { name: 'AMER' }, create: { name: 'AMER' } } } }
    });
    const waymo = await prisma.partner.create({
      data: { name: 'Waymo', type: { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } }, region: { connectOrCreate: { where: { name: 'AMER' }, create: { name: 'AMER' } } } }
    });

    // Create a person currently at Waymo, but historically at Ford
    const person = await prisma.person.create({
      data: {
        name: 'Alice Smith',
        email: 'asmith@example.com',
        currentPartnerId: waymo.id,
        notes: 'Lead integration specialist for autonomous compute platforms.'
      }
    });
    personId = person.id;

    // Create historical affiliations
    // Ford: Jan 2025 - Dec 2025
    await prisma.personAffiliation.create({
      data: {
        personId: person.id,
        partnerId: ford.id,
        role: 'Embedded Software Engineer',
        startDate: new Date('2025-01-01T00:00:00Z'),
        endDate: new Date('2025-12-31T23:59:59Z')
      }
    });

    // Waymo: Jan 2026 - Present (endDate is null)
    await prisma.personAffiliation.create({
      data: {
        personId: person.id,
        partnerId: waymo.id,
        role: 'Systems Engineer',
        startDate: new Date('2026-01-01T00:00:00Z')
      }
    });

    // Create projects for actions
    const fordProject = await prisma.project.create({
      data: { name: 'Ford F-150 AAOS Sync', partnerId: ford.id }
    });
    const fordPhase = await prisma.phase.create({
      data: { name: 'BSP power-on', projectId: fordProject.id }
    });

    const waymoProject = await prisma.project.create({
      data: { name: 'Waymo Gen 6 Integration', partnerId: waymo.id }
    });
    const waymoPhase = await prisma.phase.create({
      data: { name: 'Compute integration', projectId: waymoProject.id }
    });

    // Create historical ActionItem (created in June 2025 when Alice was at Ford)
    await prisma.actionItem.create({
      data: {
        phaseId: fordPhase.id,
        description: 'Resolve CAN bus packet drops',
        status: 'Completed',
        assignedToPersonId: person.id,
        createdAt: new Date('2025-06-15T12:00:00Z')
      }
    });

    // Create current ActionItem (created in Feb 2026 when Alice is at Waymo)
    await prisma.actionItem.create({
      data: {
        phaseId: waymoPhase.id,
        description: 'Verify redundant power supply config',
        status: 'Pending',
        assignedToPersonId: person.id,
        createdAt: new Date('2026-02-10T09:00:00Z')
      }
    });
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test('should display biography and career timeline for a person', async ({ page }) => {
    await page.goto(`/people/${personId}`);

    // Verify profile header details
    await expect(page.locator('h1')).toContainText('Alice Smith');
    await expect(page.locator('body')).toContainText('Waymo');
    await expect(page.locator('body')).toContainText('Lead integration specialist');

    // History lists PRIOR companies; the current post (Waymo · Systems Engineer)
    // lives in the identity line.
    await expect(page.locator('body')).toContainText('History');
    await expect(page.locator('body')).toContainText('Embedded Software Engineer');
    await expect(page.locator('body')).toContainText('Ford');
    await expect(page.locator('body')).toContainText('Systems Engineer');
  });

  test('lists the programs the person worked on, as links', async ({ page }) => {
    await page.goto(`/people/${personId}`);

    // Programs derive from phase involvement + assigned actions — both appear, linked.
    await expect(page.getByRole('link', { name: 'Ford F-150 AAOS Sync' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Waymo Gen 6 Integration' })).toBeVisible();
    // The action-item prose itself is no longer a person-page concern.
    await expect(page.locator('body')).not.toContainText('Resolve CAN bus packet drops');
  });

  test('any login can create a Person from the directory kebab', async ({ page }) => {
    await page.goto('/people');

    const dialog = page.locator('dialog[open]');
    await expect(async () => {
      if (!(await dialog.isVisible())) {
        const item = page.getByTestId('new-person');
        if (!(await item.isVisible())) await page.getByTestId('kebab-menu').click({ timeout: 2000 });
        await item.click({ timeout: 2000 });
      }
      await expect(dialog).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 20000 });

    await dialog.locator('#npName').fill('Priya Nair');
    await dialog.locator('#npEmail').fill('priya@ford.example');
    await dialog.locator('#npPartner').selectOption({ label: 'Ford' });
    await dialog.locator('#npRole').fill('Connectivity Lead');
    await dialog.locator('button:has-text("Save")').last().click();

    await page.waitForURL(/\/people\/\d+/);
    await expect(page.locator('h1')).toContainText('Priya Nair');
    await expect(page.locator('body')).toContainText('Ford');
    await expect(page.locator('body')).toContainText('Connectivity Lead');
  });

  test('a login can assign a person onto a program phase from the kebab', async ({ page }) => {
    await page.goto(`/people/${personId}`);

    const dialog = page.locator('dialog[open]');
    await expect(async () => {
      if (!(await dialog.isVisible())) {
        const item = page.getByTestId('add-to-program');
        if (!(await item.isVisible())) await page.getByTestId('kebab-menu').click({ timeout: 2000 });
        await item.click({ timeout: 2000 });
      }
      await expect(dialog).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 20000 });

    await dialog.locator('#assignProgram').selectOption({ label: 'Waymo Gen 6 Integration' });
    await dialog.locator('#assignPhase').selectOption({ label: 'Compute integration' });
    await dialog.locator('#assignRole').fill('Integration lead');
    await dialog.locator('button:has-text("Save")').last().click();
    await expect(page.locator('dialog[open]')).toHaveCount(0);

    // The Programs section now carries the phase chip with the role.
    await expect(page.getByRole('link', { name: /Compute integration/ })).toBeVisible();
    await expect(page.locator('body')).toContainText('Integration lead');
  });

  test('the people directory lists everyone with company and role', async ({ page }) => {
    await page.goto('/people');

    const row = page.locator('tr').filter({ hasText: 'Alice Smith' });
    await expect(row).toBeVisible();
    await expect(row).toContainText('Waymo');
    await expect(row).toContainText('Systems Engineer');

    // Company deep-link preselects the funnel (design.md §6).
    await page.goto('/people?company=Ford');
    await expect(page.locator('body')).not.toContainText('Alice Smith');
  });
});
