import { test, expect } from '@playwright/test';
import { prisma } from '../src/lib/db';

test.describe('Needle Gauge Display and Updates', () => {
  test.describe.configure({ mode: 'serial' });

  let partnerId: number;
  let projectId: number;
  let phaseId: number;

  test.beforeAll(async () => {
    // Clear and seed test records
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
        name: 'Tesla Motors',
        type: { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } }
      }
    });
    partnerId = partner.id;

    const project = await prisma.project.create({
      data: {
        name: 'Tesla Model S Infotainment',
        partnerId: partner.id,
        ownerName: 'dylan',
        sopDate: new Date('2028-01-01'),
        volumeFirstYear: 500000,
        theNeedle: 'Low'
      }
    });
    projectId = project.id;

    const phase = await prisma.phase.create({
      data: {
        name: 'AAOS Bring-up',
        projectId: project.id
      }
    });
    phaseId = phase.id;

    await prisma.phaseState.create({
      data: {
        phaseId: phase.id,
        status: 'Not Started',
        theNeedle: 'Low',
        hillChartProgress: 10
      }
    });
  });

  test('should allow updating the needle at the Partner (Company) level', async ({ page }) => {
    await page.goto(`/partners/${partnerId}`);

    // Verify initial state is Low
    await expect(page.locator('header')).toContainText('Low');

    // Click Update Needle in the header
    const header = page.locator('header');
    await header.locator('button:has-text("Update Needle")').click();

    // Drag slider to High range (e.g. 0.65)
    const dialog = page.locator('dialog[open]');
    await dialog.locator('input[type="range"]').fill('0.65');
    await dialog.locator('textarea[name="notes"]').fill('Tesla partnership risk is elevated due to supply chains.');
    await dialog.locator('button:has-text("Save Update")').click();

    // Verify it closed and updated value to High
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await expect(page.locator('header')).toContainText('High');
  });

  test('should allow updating the needle at the Project level', async ({ page }) => {
    await page.goto(`/projects/${projectId}`);

    // Verify initial is Low
    await expect(page.locator('[class*="summaryCard"]').first()).toContainText('Low');

    // Click Update Needle in the summary dashboard
    const card = page.locator('[class*="summaryCard"]').first();
    await card.locator('button:has-text("Update Needle")').click();

    // Drag slider to Medium (e.g. 0.35)
    const dialog = page.locator('dialog[open]');
    await dialog.locator('input[type="range"]').fill('0.35');
    await dialog.locator('textarea[name="notes"]').fill('Minor issues resolved');
    await dialog.locator('button:has-text("Save Update")').click();

    // Verify
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await expect(page.locator('[class*="summaryCard"]').first()).toContainText('Medium');
  });

  test('should allow updating the needle at the Phase level', async ({ page }) => {
    await page.goto(`/projects/${projectId}`);

    // Verify initial
    const phaseCard = page.locator('[class*="phaseCard"]').first();
    await expect(phaseCard).toContainText('Low');

    // Click Update Needle on the phase
    await phaseCard.locator('button:has-text("Update Needle")').click();

    // Drag slider to Critical (e.g. 0.9)
    const dialog = page.locator('dialog[open]');
    await dialog.locator('input[type="range"]').fill('0.9');
    await dialog.locator('textarea[name="notes"]').fill('Stuck indefinitely');
    await dialog.locator('button:has-text("Save Update")').click();

    // Verify
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await expect(phaseCard).toContainText('Critical');
  });
});
