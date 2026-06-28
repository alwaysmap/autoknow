import { test, expect } from '@playwright/test';
import { prisma } from '../src/lib/db';

test.describe('Project Details and Action Item Operations', () => {
  test.describe.configure({ mode: 'serial' });

  let projectId: number;
  let actionItemId: number;

  test.beforeAll(async () => {
    // Clear and seed clean state
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
      data: { name: 'Google Partner PE', type: { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } } }
    });

    const project = await prisma.project.create({
      data: { name: 'Android Car 2026', partnerId: partner.id }
    });
    projectId = project.id;

    const phase = await prisma.phase.create({
      data: { name: 'Compliance Testing', projectId: project.id }
    });

    await prisma.phaseState.create({
      data: {
        phaseId: phase.id,
        status: 'Not Started',
        theNeedle: 'Low',
        hillChartProgress: 10
      }
    });

    const actionItem = await prisma.actionItem.create({
      data: {
        phaseId: phase.id,
        description: 'Fix CTS testCarService failing',
        status: 'Pending',
        nextStep: 'Undecided'
      }
    });
    actionItemId = actionItem.id;
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test('should display project details and allow updating action item properties', async ({ page }) => {
    await page.goto(`/projects/${projectId}`);

    // Verify page content
    await expect(page.locator('h1')).toContainText('Android Car 2026');
    await expect(page.locator('body')).toContainText('Compliance Testing');
    await expect(page.locator('body')).toContainText('Fix CTS testCarService failing');

    // Perform update on action item status, next step, and link
    const itemContainer = page.locator(`.action-item-${actionItemId}`);
    await itemContainer.locator('select[name="nextStep"]').selectOption('Partner');
    await itemContainer.locator('input[name="linkUrl"]').fill('https://buganizer.corp.google.com/issues/12345');
    await itemContainer.locator('select[name="status"]').selectOption('Completed');
    
    // Submit the update
    await itemContainer.locator('button[type="submit"]').click();

    // Verify redirected page shows updated details
    await expect(page.locator(`.action-item-${actionItemId}`)).toContainText('Partner');
    await expect(page.locator(`.action-item-${actionItemId} a`)).toHaveAttribute('href', 'https://buganizer.corp.google.com/issues/12345');
    await expect(page.locator(`.action-item-${actionItemId}`)).toContainText('Completed');
  });

  test('should allow updating overall project health (Needle) and progress (Hill Chart)', async ({ page }) => {
    await page.goto(`/projects/${projectId}`);

    // Update health needle via dialog
    await page.click('button:has-text("Update Needle")');
    await page.locator('dialog[open] #needleSlider').fill('0.85');
    await page.fill('#needleNotes', 'Critical timeline blockers piling up');
    await page.click('button:has-text("Save Update")');

    // Update hill progress via dialog
    await page.click('button:has-text("Update Progress")');
    await page.locator('#progressSlider').fill('85');
    await page.fill('#progressNotes', 'Milestone completed early');
    await page.click('button:has-text("Save Progress Update")');

    // Verify values updated on dashboard cards
    await expect(page.locator('body')).toContainText('Critical');
    await expect(page.locator('body')).toContainText('Milestone completed early');
  });

  test('should allow updating a phase status, Needle risk level, and Hill chart progress', async ({ page }) => {
    await page.goto(`/projects/${projectId}`);

    // Update phase Needle risk level using the NeedleGauge modal dialog
    const phaseContainer = page.locator('[class*="phaseCard"]').first();
    await phaseContainer.locator('button:has-text("Update Needle")').click();
    
    const dialog = page.locator('dialog[open]');
    await dialog.locator('#needleSlider').fill('0.65');
    await dialog.locator('textarea[name="notes"]').fill('Phase risk is elevated');
    await dialog.locator('button:has-text("Save Update")').click();

    // Fill phase tagging form for status and progress
    const form = page.locator('form').filter({ hasText: 'Tag Phase' });
    await form.locator('select[name="status"]').selectOption('Active WIP');
    await form.locator('input[name="hillChartProgress"]').fill('60');
    await form.locator('button:has-text("Tag Phase")').click();

    // Verify status badge and visual flow step shows updated state
    await expect(page.locator('[class*="phaseStatusRow"]').first()).toContainText('Active WIP', { timeout: 10000 });
    await expect(page.locator('[class*="phaseStatusRow"]').first()).toContainText('High', { timeout: 10000 });
    await expect(page.locator('[class*="flowStepMeta"]').first()).toContainText('High Risk', { timeout: 10000 });
  });
});
