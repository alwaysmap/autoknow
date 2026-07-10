import { test, expect } from '@playwright/test';
import { prisma } from './helpers/db';
import { wipeAll } from './helpers/fixtures';

test.describe('Projects and Partners Flow', () => {
  // Set describe to serial mode to ensure they execute sequentially without database race conditions
  test.describe.configure({ mode: 'serial' });

  let fordId: number;
  let boschId: number;

  test.beforeAll(async () => {
    // Clear existing data to ensure a clean state
    await wipeAll();

    // Create seed partners
    const ford = await prisma.partner.create({
      data: { name: 'Ford', type: { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } } }
    });
    fordId = ford.id;

    await prisma.partner.create({
      data: { name: 'Toyota', type: { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } } }
    });

    const bosch = await prisma.partner.create({
      data: { name: 'Bosch', type: { connectOrCreate: { where: { name: 'Supplier' }, create: { name: 'Supplier' } } } }
    });
    boschId = bosch.id;

    // Create a Bosch project to start with
    await prisma.project.create({
      data: {
        name: 'Ford Explorer VHAL Integration (Bosch)',
        partnerId: bosch.id
      }
    });
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test('should allow creating a new project from a template', async ({ page }) => {
    await page.goto('/projects/new');

    // Fill the project creation form
    await page.fill('input[name="name"]', 'Ford F-150 AAOS Bring-up');
    await page.selectOption('select[name="partnerId"]', fordId.toString());
    await page.selectOption('select[name="template"]', 'AAOS');
    await page.fill('input[name="owner"]', '@dylan');

    // Submit form
    await page.click('button[type="submit"]');

    // Should redirect to project details page
    await page.waitForURL(/\/projects\/\d+/, { timeout: 10000 });
    
    // Expect project name to be visible on the redirected page
    await expect(page.locator('body')).toContainText('Ford F-150 AAOS Bring-up');
  });

  test('should display user projects on My Projects page', async ({ page }) => {
    // Navigate to My Projects
    await page.goto('/my-projects?user=@dylan');

    // Verify projects owned by @dylan are listed
    await expect(page.locator('body')).toContainText('Ford F-150 AAOS Bring-up');
  });

  test('should list the programs a partner owns on the partner page', async ({ page }) => {
    // Navigate to the Bosch partner page
    await page.goto(`/partners/${boschId}`);

    // The Programs summary shows what Bosch owns, badged as Owner.
    await expect(page.locator('h1')).toContainText('Bosch');
    await expect(page.locator('body')).toContainText('Programs');
    await expect(page.locator('body')).toContainText('Owner');
  });
});
