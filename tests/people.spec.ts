import { test, expect } from './helpers/e2e';
import { prisma } from './helpers/db';
import { wipeAll } from './helpers/fixtures';

test.describe('People and Biographical History', () => {
  test.describe.configure({ mode: 'serial' });

  let personId: number;
  // Someone whose only employment period has ENDED, so no period covers today. Since
  // #127 E5 that is a renderable state rather than an impossible one — the pages must
  // say nothing about a company rather than fall back to the stale cache.
  let betweenJobsId: number;

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

    // The between-jobs case. `currentPartnerId` still points at Ford — the cache is not
    // maintained on the way out — so any surface reading it would confidently print
    // "Ford". Only the as-of predicate knows she is not there.
    const between = await prisma.person.create({
      data: {
        name: 'Nadia Between',
        email: 'nadia@example.com',
        currentPartnerId: ford.id,
      },
    });
    betweenJobsId = between.id;
    await prisma.personAffiliation.create({
      data: {
        personId: between.id,
        partnerId: ford.id,
        role: 'Validation Engineer',
        startDate: new Date('2021-01-01T00:00:00Z'),
        endDate: new Date('2024-06-01T00:00:00Z'),
      },
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

  test('a person with no period covering today shows no company, rather than the stale cache', async ({ page }) => {
    await page.goto(`/people/${betweenJobsId}`);

    // The identity line itself, not the page header — the header also contains the
    // kebab's dialogs, whose partner picker lists every partner including Ford.
    const ident = page.locator('[class*="identLine"]');
    await expect(ident).toContainText('nadia@example.com');
    // The cache says Ford. The identity line must not, and must not link to it either —
    // this is the assertion that fails if anyone reintroduces a currentPartner read.
    await expect(ident).not.toContainText('Ford');
    await expect(ident.locator('a[href^="/partners/"]')).toHaveCount(0);
    // Her ENDED Ford period is still history, and still says Ford — the page is silent
    // about today, not about her career.
    await expect(page.locator('body')).toContainText('Validation Engineer');
  });

  test('the directory leaves both company and role blank for that person', async ({ page }) => {
    await page.goto('/people');

    // Company and Role come from ONE row now, so they are blank together. A row naming a
    // company with no role is the half-and-half state #127 E5 removed.
    const row = page.getByRole('row').filter({ hasText: 'Nadia Between' });
    await expect(row).toBeVisible();
    await expect(row).not.toContainText('Ford');
    await expect(row).not.toContainText('Validation Engineer');
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

});
