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

  test('should display matching database results and empty vector matches notice before seeding', async ({ page }) => {
    await page.goto('/search?q=Ford');

    // Verify page title and header
    await expect(page.locator('h1')).toContainText('Search Results');
    await expect(page.locator('body')).toContainText('Ford');

    // Verify database match lists
    await expect(page.locator('body')).toContainText('Ford Evos AAOS Bring-up');

    // Check empty vector message
    await expect(page.locator('body')).toContainText('No semantic matches found in pgvector index.');
  });
});
