import { test, expect } from '../helpers/e2e';
import { prisma } from '../helpers/db';
import { wipeAll } from '../helpers/fixtures';

test.describe('Google Chat Integration Webhook', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    // Clear and seed clean projects for classification test
    await wipeAll();

    const oem = await prisma.partner.create({
      data: { name: 'Toyota', type: { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } }, region: { connectOrCreate: { where: { name: 'AMER' }, create: { name: 'AMER' } } } }
    });

    await prisma.project.create({
      data: { name: 'Toyota LandCruiser GAS Integration', partnerId: oem.id }
    });
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test('should accept Google Chat messages and return parsed action items', async ({ request }) => {
    const payload = {
      message: '@autoknow @jdoe needs to decide on hypervisor topology by tomorrow'
    };

    const response = await request.post('/api/integrations/chat', {
      data: payload
    });

    expect(response.status()).toBe(200);
    
    const data = await response.json();
    expect(data).toHaveProperty('actionItem');
    expect(data.actionItem.assignedTo).toBe('@jdoe');
    expect(data.actionItem.description).toContain('decide on hypervisor topology');
  });

  test('should return 200 with empty actionItem if message contains no action item', async ({ request }) => {
    const payload = {
      message: 'Hello team, quick sync at 5pm'
    };

    const response = await request.post('/api/integrations/chat', {
      data: payload
    });

    expect(response.status()).toBe(200);
    
    const data = await response.json();
    expect(data.actionItem).toBeNull();
  });

  test('should route status updates using smart keyword matching when high confidence', async ({ request }) => {
    const payload = {
      message: '@autoknow share update: LandCruiser has successfully resolved the Audio HAL test crash.'
    };

    const response = await request.post('/api/integrations/chat', {
      data: payload
    });

    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.ingested).toBe(true);
    expect(data.projectName).toBe('Toyota LandCruiser GAS Integration');
  });

  test('should reject status updates when project is ambiguous or missing matching keywords', async ({ request }) => {
    const payload = {
      message: '@autoknow share update: General Motors CarPlay integration is blocked.'
    };

    const response = await request.post('/api/integrations/chat', {
      data: payload
    });

    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.ingested).toBe(false);
    expect(data.error).toBe('I don\'t have a project matching this message or comment. Create one first or provide more context.');
  });
});
