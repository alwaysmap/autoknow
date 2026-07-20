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
        type: { connectOrCreate: { where: { name: 'Supplier' }, create: { name: 'Supplier' } } }, region: { connectOrCreate: { where: { name: 'AMER' }, create: { name: 'AMER' } } }
      }
    });
    partnerId = partner.id;

    // A second partner of another type so the Type funnel has a real choice.
    await prisma.partner.create({
      data: {
        name: 'BMW Group',
        type: { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } }, region: { connectOrCreate: { where: { name: 'AMER' }, create: { name: 'AMER' } } }
      }
    });

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

    // Column funnel (design.md §6): filtering Type to OEM hides the supplier.
    await page.getByRole('button', { name: 'Filter Partner Type' }).click();
    await page.getByRole('checkbox', { name: 'OEM', exact: true }).check();
    await expect(page.locator('body')).toContainText('BMW Group');
    await expect(page.locator('body')).not.toContainText('Continental AG');

    // Clear restores the list.
    await page.getByRole('button', { name: 'Clear', exact: true }).click(); // the funnel's Clear, not the toolbar reset
    await page.keyboard.press('Escape');
    await expect(page.locator('body')).toContainText('Continental AG');

    // Filter by "My Partners Only" (dylan is TEL on the project)
    await page.check('input[id="myPartnersCheckbox"]');
    await expect(page.locator('body')).toContainText('Continental AG');
  });

  test('deep links preselect column filters (?type=)', async ({ page }) => {
    // The partner page's identity line links here; OEM-only hides the supplier.
    await page.goto('/partners?type=OEM');
    await expect(page.locator('body')).toContainText('BMW Group');
    await expect(page.locator('body')).not.toContainText('Continental AG');

    await page.goto('/partners?type=Supplier');
    await expect(page.locator('body')).toContainText('Continental AG');
    await expect(page.locator('body')).not.toContainText('BMW Group');
  });


  test('partner CRUD: create, edit, then delete', async ({ page }) => {
    await page.goto('/partners');

    // CREATE — hydration-guarded open, then the form, then the redirect to the new page.
    const dialog = page.locator('dialog[open]');
    await expect(async () => {
      if (!(await dialog.isVisible())) {
        const item = page.getByTestId('new-partner');
        if (!(await item.isVisible())) await page.getByTestId('kebab-menu').click({ timeout: 2000 });
        await item.click({ timeout: 2000 });
      }
      await expect(dialog).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 20000 });
    await dialog.locator('#pfName').fill('Rivian');
    await dialog.locator('#pfType').selectOption({ label: 'Supplier' });
    await dialog.locator('#pfRegion').selectOption({ label: 'AMER' }); // region is required
    await dialog.locator('#pfWebsite').fill('https://rivian.example');
    await dialog.locator('#pfSummary').fill('Exploratory AAOS conversations.');
    await dialog.locator('button:has-text("Save Update")').click();
    await page.waitForURL(/\/partners\/\d+/);
    await expect(page.locator('h1')).toHaveText('Rivian');
    await expect(page.locator('body')).toContainText('Exploratory AAOS conversations.');

    // EDIT — change the website; the rail's contact line reflects the hostname.
    const editDialog = page.locator('dialog[open]');
    await expect(async () => {
      if (!(await editDialog.isVisible())) {
        const item = page.getByRole('button', { name: 'Edit', exact: true });
        if (!(await item.isVisible())) await page.getByTestId('kebab-menu').click({ timeout: 2000 });
        await item.click({ timeout: 2000 });
      }
      await expect(editDialog).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 20000 });
    await editDialog.locator('#pfWebsite').fill('https://rivian-updated.example');
    await editDialog.locator('button:has-text("Save Update")').click();
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await expect(page.locator('body')).toContainText('rivian-updated.example');

    // DELETE — no programs/people on Rivian, so the name-confirm flow applies.
    const delDialog = page.locator('dialog[open]');
    await expect(async () => {
      if (!(await delDialog.isVisible())) {
        const item = page.getByTestId('delete-partner');
        if (!(await item.isVisible())) await page.getByTestId('kebab-menu').click({ timeout: 2000 });
        await item.click({ timeout: 2000 });
      }
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
      if (!(await dialog.isVisible())) {
        const item = page.getByTestId('delete-partner');
        if (!(await item.isVisible())) await page.getByTestId('kebab-menu').click({ timeout: 2000 });
        await item.click({ timeout: 2000 });
      }
      await expect(dialog).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 20000 });

    // Explains the blocker; offers no doomed confirm input.
    await expect(dialog).toContainText('still owns 1 program');
    await expect(dialog.locator('#confirmPartnerName')).toHaveCount(0);
  });

});
