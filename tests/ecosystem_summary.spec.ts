import { test, expect } from './helpers/e2e';
import { prisma } from './helpers/db';
import { wipeAll } from './helpers/fixtures';

test.describe('Ecosystem Summary Page (Deterministic + AI)', () => {
  test.describe.configure({ mode: 'serial' });

  let projectId: number;

  test.beforeAll(async () => {
    // Clear and seed a simple project to test status updates
    await wipeAll();

    const partner = await prisma.partner.create({
      data: { name: 'Waymo', type: { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } }, region: { connectOrCreate: { where: { name: 'AMER' }, create: { name: 'AMER' } } } }
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

  test('should display deterministic metrics and filters on Ecosystem Summary page', async ({ page }) => {
    await page.goto('/ecosystem-summary');

    // 1. Check title
    await expect(page.locator('h1')).toContainText('Ecosystem');

    // 2. The scorecard strip is retired — no big-number cards.
    await expect(page.locator('body')).not.toContainText('Programs in Flight');

    // 3-5. Filtering is the shared table grammar now (#95): the owner <select> and the
    // health-floor slider became in-header funnels, and the progress band was retired.
    // Two things worth asserting — that a funnel WRITES the URL, and that the URL is
    // read back on a cold load, which is the half most likely to rot (design.md §2).
    await page.getByRole('button', { name: /^filter owner$/i }).click();
    await page.getByRole('checkbox', { name: 'Dylan' }).check();
    await expect(page).toHaveURL(/ownerName=Dylan/);
    await expect(page.locator('body')).toContainText('Waymo Generation 6 AAOS');

    await page.getByRole('button', { name: /clear filters/i }).click();
    await expect(page).not.toHaveURL(/ownerName=/);

    // A NON-matching deep link, so the assertion means something: this fixture has one
    // program, so "still visible" is true either way and only a disappearance proves the
    // filter ran. Cold load, so the server-side parseFilterParams path is the one tested.
    //
    // Scoped to the launches table, NOT the body: the Flow Constraint panel above also
    // names this program, so a page-wide "not visible" would fail while the filter is
    // working perfectly — which is exactly what it did on first run.
    const launches = page.locator('section', { hasText: 'Program Lifecycle & Launches' }).last();
    await page.goto('/ecosystem-summary?ownerName=NoSuchOwner');
    await expect(launches).toContainText('No programs match current filters.');
    await expect(launches).not.toContainText('Waymo Generation 6 AAOS');

    await page.goto('/ecosystem-summary');
    await expect(launches).toContainText('Waymo Generation 6 AAOS');

    // 6. Flow Constraint Diagnosis reports the LIVE critical chain (#129).
    //
    // This block used to assert 'Compliance Testing (Phase 3.1)' and '54 days' — the
    // five literals typed into the panel's JSX. The test passed for exactly the reason
    // the panel was broken: both the page and the assertion had the answer hard-coded,
    // so no amount of e2e could notice the data was never consulted. Assert the SHAPE
    // instead: a phase this seeded program actually has, the program it gates, and the
    // badge — all of which move when the data moves.
    await expect(page.locator('body')).toContainText('Flow Constraint Diagnosis');
    const diagnosis = page.locator('section', { hasText: 'Flow Constraint Diagnosis' }).first();
    await expect(diagnosis).toContainText('On a critical chain');
    await expect(diagnosis).toContainText('gating 1 program');
    // The only live program in this fixture, so it must be the one being gated.
    await expect(diagnosis).toContainText('Waymo Generation 6 AAOS');

    // 7. The program table names the program; the ingested digest itself lives in
    // the feeds now (the pseudo-synthesis block is retired).
    await expect(page.locator('body')).toContainText('Waymo Generation 6 AAOS');
  });
});
