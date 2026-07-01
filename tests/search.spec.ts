import { test, expect } from '@playwright/test';
import { prisma } from '../src/lib/db';

test.describe('Search Results Page (Text + pgvector)', () => {
  test.beforeAll(async () => {
    // Clear and seed a simple project to search
    await prisma.actionItem.deleteMany();
    await prisma.contextUrl.deleteMany();
    await prisma.phaseState.deleteMany();
    await prisma.phaseDependency.deleteMany();
    await prisma.phase.deleteMany();
    await prisma.projectState.deleteMany();
    await prisma.partnerState.deleteMany();
    await prisma.project.deleteMany();
    await prisma.personAffiliation.deleteMany();
    await prisma.person.deleteMany();
    await prisma.partner.deleteMany();

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

    // Unified search header + the search box pre-filled from ?q=
    await expect(page.locator('h1')).toContainText('Search');
    await expect(page.locator('input[type="search"]')).toBeVisible();
    await expect(page.locator('input[type="search"]')).toHaveValue('Ford');

    // Type filter chips (include/exclude) are present for every searchable type
    for (const t of ['Partners', 'Programs', 'People', 'Context']) {
      await expect(page.getByRole('button', { name: t, exact: true })).toBeVisible();
    }
  });
});
