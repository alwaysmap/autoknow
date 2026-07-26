import { test, expect } from './helpers/e2e';
import { prisma } from './helpers/db';
import { wipeAll } from './helpers/fixtures';

test.describe('Me Landing Page', () => {
  test.beforeAll(async () => {
    // Clear and seed clean test data for @dylan
    await wipeAll();

    const partner = await prisma.partner.create({
      data: {
        name: 'Google LLC',
        type: { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } }, region: { connectOrCreate: { where: { name: 'AMER' }, create: { name: 'AMER' } } }
      }
    });

    const person = await prisma.person.create({
      data: {
        name: 'Dylan Lead',
        email: 'dylan@google.com',
        currentPartnerId: partner.id,
        notes: 'Technical Engagement Lead for Android Automotive'
      }
    });

    await prisma.personAffiliation.create({
      data: {
        personId: person.id,
        partnerId: partner.id,
        role: 'TEL',
        startDate: new Date('2024-01-01')
      }
    });

    const project = await prisma.project.create({
      data: {
        name: 'AAOS Google Integration',
        partnerId: partner.id,
        ownerName: 'dylan@google.com',
        sopDate: new Date('2026-12-01'),
        volumeFirstYear: 500000
      }
    });

    const phase = await prisma.phase.create({
      data: {
        name: 'VHAL Sync',
        projectId: project.id
      }
    });

    await prisma.actionItem.create({
      data: {
        phaseId: phase.id,
        description: 'Verify HAL interface requirements with Google team',
        assignedTo: '@dylan',
        status: 'Pending'
      }
    });
  });

  test('redirects to the canonical person page with profile and programs', async ({ page }) => {
    // Navigate to /me
    await page.goto('/me?user=@dylan');
    await page.waitForURL(/\/people\/\d+/); // /me is a shortcut to the person page

    // Verify profile info
    await expect(page.locator('body')).toContainText('Dylan Lead');
    await expect(page.locator('body')).toContainText('Technical Engagement Lead for Android Automotive');

    // Verify Project accountabilities
    await expect(page.locator('body')).toContainText('AAOS Google Integration');
  });

  test('a login without a Person self-provisions from /me', async ({ page }) => {
    // @casey has a login (any domain member can) but no Person record yet.
    await page.goto('/me?user=@casey');
    await expect(page.locator('body')).toContainText('No person profile matches');

    await page.selectOption('select[name="partnerId"]', { label: 'Google LLC' });
    await page.getByTestId('create-my-profile').click();

    // Lands on the canonical person page; identity came from the login. The
    // directory records a human NAME ('Casey'), not the raw handle — the handle
    // stays the lookup key, and people read the directory.
    await page.waitForURL(/\/people\/\d+/);
    await expect(page.locator('h1')).toContainText('Casey');
    await expect(page.locator('body')).toContainText('casey@google.com');
    await expect(page.locator('body')).toContainText('Google LLC');
  });

  test('should transparently redirect from legacy my-projects path to me page', async ({ page }) => {
    await page.goto('/my-projects?user=@dylan');
    // chains /my-projects → /me → the canonical person page
    await page.waitForURL(/\/people\/\d+/, { timeout: 5000 });
    await expect(page.locator('body')).toContainText('Dylan Lead');
  });
});
