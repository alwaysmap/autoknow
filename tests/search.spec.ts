import { test, expect } from '@playwright/test';
import { prisma } from './helpers/db';
import { wipeAll } from './helpers/fixtures';

test.describe('Search Results Page (Text + pgvector)', () => {
  test.beforeAll(async () => {
    // Clear and seed a simple project to search
    await wipeAll();

    const partner = await prisma.partner.create({
      data: { name: 'Ford', type: { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } } }
    });

    await prisma.project.create({
      data: {
        name: 'Ford Evos AAOS Bring-up',
        partnerId: partner.id,
        ownerName: 'Dylan',
        sopDate: new Date('2027-06-30T00:00:00Z'),
        volumeFirstYear: 150000,
        theNeedle: 'High'
      }
    });
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test('should render the unified search with type filter chips', async ({ page }) => {
    await page.goto('/search?q=Ford');

    // Unified search header + the page's search box pre-filled from ?q= (the global
    // nav search also exists, so target by placeholder).
    await expect(page.locator('h1')).toContainText('Search');
    const searchBox = page.getByPlaceholder('Search partners, programs, people, context…');
    await expect(searchBox).toBeVisible();
    await expect(searchBox).toHaveValue('Ford');

    // Type filter chips (include/exclude) are present for every searchable type
    for (const t of ['Partners', 'Programs', 'People', 'Context']) {
      await expect(page.getByRole('button', { name: t, exact: true })).toBeVisible();
    }
  });
});
