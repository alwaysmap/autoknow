import { test, expect } from '@playwright/test';
import { prisma } from '../src/lib/db';

test.describe('Me Landing Page', () => {
  test.beforeAll(async () => {
    // Clear and seed clean test data for @dylan
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
      data: {
        name: 'Google LLC',
        type: { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } }
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

  test('should display biographical profile and project checklist accountabilities', async ({ page }) => {
    // Navigate to /me
    await page.goto('/me?user=@dylan');

    // Verify profile info
    await expect(page.locator('body')).toContainText('Dylan Lead');
    await expect(page.locator('body')).toContainText('Technical Engagement Lead for Android Automotive');

    // Verify Action Items checklist
    await expect(page.locator('body')).toContainText('Verify HAL interface requirements with Google team');

    // Verify Project accountabilities
    await expect(page.locator('body')).toContainText('AAOS Google Integration');
  });

  test('should transparently redirect from legacy my-projects path to me page', async ({ page }) => {
    await page.goto('/my-projects?user=@dylan');
    await page.waitForURL(/\/me\?user=.+/, { timeout: 5000 });
    await expect(page.locator('body')).toContainText('Dylan Lead');
  });
});
