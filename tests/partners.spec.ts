import { test, expect } from '@playwright/test';
import { prisma } from './helpers/db';
import { wipeAll } from './helpers/fixtures';

test.describe('Ecosystem Partners Page', () => {
  let partnerId: number;

  test.beforeAll(async () => {
    // Clean and seed a supplier partner
    await wipeAll();

    const partner = await prisma.partner.create({
      data: {
        name: 'Continental AG',
        type: { connectOrCreate: { where: { name: 'Supplier' }, create: { name: 'Supplier' } } }
      }
    });
    partnerId = partner.id;

    // Create a program under this partner
    await prisma.project.create({
      data: {
        name: 'Continental VHAL Integration',
        partnerId: partner.id,
        ownerName: 'dylan@google.com',
        sopDate: new Date('2027-06-01'),
        volumeFirstYear: 150000
      }
    });
  });

  test('should display list of partners and support filtering', async ({ page }) => {
    await page.goto('/partners');

    // Verify Continental AG is in the list
    await expect(page.locator('body')).toContainText('Continental AG');
    await expect(page.locator('body')).toContainText('Supplier');
    await expect(page.locator('body')).toContainText('1 active');

    // Filter by OEM should hide Continental AG
    await page.selectOption('select[id="typeSelect"]', 'OEM');
    await expect(page.locator('body')).toContainText('No ecosystem partners found matching filters.');

    // Reset filter
    await page.selectOption('select[id="typeSelect"]', 'All');
    await expect(page.locator('body')).toContainText('Continental AG');

    // Filter by "My Partners Only" (dylan is TEL on the project)
    await page.check('input[id="myPartnersCheckbox"]');
    await expect(page.locator('body')).toContainText('Continental AG');
  });
});
