import { test, expect } from '@playwright/test';
import { prisma } from './helpers/db';
import { wipeAll } from './helpers/fixtures';

test.describe('Ecosystem Partners Page', () => {
  test.describe.configure({ mode: 'serial' });

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

  test('shows relative relationship health (1..7) for every partner', async ({ page }) => {
    // Rate Continental so the list has a real position to show.
    await prisma.partnerState.create({
      data: { partnerId, relationshipScore: 5, theNeedle: 'Some Risk', notes: 'Quarterly review.' },
    });

    await page.goto('/partners');
    await expect(page.locator('th', { hasText: 'Relationship' })).toBeVisible();
    const row = page.locator('tr').filter({ hasText: 'Continental AG' });
    await expect(row).toContainText('5/7');
  });

  test('partner CRUD: create, edit, then delete', async ({ page }) => {
    await page.goto('/partners');

    // CREATE — hydration-guarded open, then the form, then the redirect to the new page.
    const dialog = page.locator('dialog[open]');
    await expect(async () => {
      if (!(await dialog.isVisible())) await page.getByTestId('new-partner').click({ timeout: 2000 });
      await expect(dialog).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 20000 });
    await dialog.locator('#pfName').fill('Rivian');
    await dialog.locator('#pfType').selectOption({ label: 'Supplier' });
    await dialog.locator('#pfWebsite').fill('https://rivian.example');
    await dialog.locator('#pfSummary').fill('Exploratory AAOS conversations.');
    await dialog.locator('button:has-text("Save Update")').click();
    await page.waitForURL(/\/partners\/\d+/);
    await expect(page.locator('h1')).toHaveText('Rivian');
    await expect(page.locator('body')).toContainText('Exploratory AAOS conversations.');

    // EDIT — change the phone; the Key Details sidebar reflects it.
    const editDialog = page.locator('dialog[open]');
    await expect(async () => {
      if (!(await editDialog.isVisible())) {
        await page.getByRole('button', { name: 'Edit', exact: true }).click({ timeout: 2000 });
      }
      await expect(editDialog).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 20000 });
    await editDialog.locator('#pfPhone').fill('+1 555 0100');
    await editDialog.locator('button:has-text("Save Update")').click();
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await expect(page.locator('body')).toContainText('+1 555 0100');

    // DELETE — no programs/people on Rivian, so the name-confirm flow applies.
    const delDialog = page.locator('dialog[open]');
    await expect(async () => {
      if (!(await delDialog.isVisible())) await page.getByTestId('delete-partner').click({ timeout: 2000 });
      await expect(delDialog).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 20000 });
    const confirmBtn = delDialog.locator('button:has-text("Permanently delete partner")');
    await expect(confirmBtn).toBeDisabled(); // until the exact name is typed
    await delDialog.locator('#confirmPartnerName').fill('Rivian');
    await confirmBtn.click();
    await page.waitForURL(/\/partners$/);
    await expect(page.locator('body')).not.toContainText('Rivian');
    expect(await prisma.partner.count({ where: { name: 'Rivian' } })).toBe(0);
  });

  test('delete refuses honestly while the partner still owns programs', async ({ page }) => {
    await page.goto(`/partners/${partnerId}`);

    const dialog = page.locator('dialog[open]');
    await expect(async () => {
      if (!(await dialog.isVisible())) await page.getByTestId('delete-partner').click({ timeout: 2000 });
      await expect(dialog).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 20000 });

    // Explains the blocker; offers no doomed confirm input.
    await expect(dialog).toContainText('still owns 1 program');
    await expect(dialog.locator('#confirmPartnerName')).toHaveCount(0);
  });
});
