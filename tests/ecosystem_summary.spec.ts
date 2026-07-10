import { test, expect } from '@playwright/test';
import { prisma } from './helpers/db';
import { wipeAll } from './helpers/fixtures';

test.describe('Ecosystem Summary Page (Deterministic + AI)', () => {
  test.describe.configure({ mode: 'serial' });

  let projectId: number;

  test.beforeAll(async () => {
    // Clear and seed a simple project to test status updates
    await wipeAll();

    const partner = await prisma.partner.create({
      data: { name: 'Waymo', type: { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } } }
    });

    const project = await prisma.project.create({
      data: {
        name: 'Waymo Generation 6 AAOS',
        partnerId: partner.id,
        ownerName: 'Dylan',
        sopDate: new Date('2027-01-01'),
        volumeFirstYear: 150000,
        theNeedle: 'High',
        hillChartProgress: 35
      }
    });
    projectId = project.id;

    // Create a phase to attach the status update to
    const phase = await prisma.phase.create({
      data: { name: 'BSP & power-on', projectId: project.id }
    });

    // Seed state for phase
    await prisma.phaseState.create({
      data: {
        phaseId: phase.id,
        status: 'Active WIP',
        theNeedle: 'High',
        hillChartProgress: 35
      }
    });
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test('should ingest status updates from Google Chat webhook', async ({ request }) => {
    const payload = {
      message: '@autoknow status update for "Waymo Generation 6 AAOS": HW bring-up is green. Audio HAL integration is blocked due to delayed codec samples from supplier.'
    };

    const response = await request.post('/api/integrations/chat', {
      data: payload
    });

    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.ingested).toBe(true);

    // Verify it exists in database
    const contextUrl = await prisma.contextUrl.findFirst({
      where: { projectId: projectId }
    });
    expect(contextUrl).not.toBeNull();
    expect(contextUrl?.ingestedText).toContain('Audio HAL integration is blocked');
  });

  test('should display deterministic metrics and AI synthesis on Ecosystem Summary page', async ({ page }) => {
    await page.goto('/ecosystem-summary');

    // 1. Check title
    await expect(page.locator('h1')).toContainText('Ecosystem');

    // 2. Check leadership metrics
    await expect(page.locator('body')).toContainText('Programs in Flight');
    await expect(page.locator('body')).toContainText('150,000'); // volume
    await expect(page.locator('body')).toContainText('Programs in Range');

    // 3. Test filter by Googler Owner
    await page.selectOption('select[id="ownerSelect"]', 'Dylan');
    await expect(page.locator('body')).toContainText('Waymo Generation 6 AAOS');

    // 4. Test risk floor slider
    // Set risk floor to "Critical" (value "3"), which should hide our "High" risk program
    await page.fill('input[id="riskSlider"]', '3');
    await expect(page.locator('body')).toContainText('No programs match current filters.');

    // Reset risk floor to "Low" (value "0")
    await page.fill('input[id="riskSlider"]', '0');
    await expect(page.locator('body')).toContainText('Waymo Generation 6 AAOS');

    // 5. Test progress range filter
    await page.fill('input[id="maxProgressSlider"]', '50');
    await expect(page.locator('body')).toContainText('Waymo Generation 6 AAOS');

    // 6. Check Flow Constraint Diagnosis
    await expect(page.locator('body')).toContainText('Flow Constraint Diagnosis');
    await expect(page.locator('body')).toContainText('Compliance Testing (Phase 3.1)');
    await expect(page.locator('body')).toContainText('54 days');

    // 7. Check AI-synthesized context
    await expect(page.locator('body')).toContainText('Waymo Generation 6 AAOS');
    await expect(page.locator('body')).toContainText('Audio HAL integration is blocked');
  });
});
