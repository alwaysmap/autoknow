import { test, expect } from '@playwright/test';
import { prisma } from './helpers/db';
import { wipeAll } from './helpers/fixtures';

test.describe('Projects and Partners Flow', () => {
  // Set describe to serial mode to ensure they execute sequentially without database race conditions
  test.describe.configure({ mode: 'serial' });

  let fordId: number;
  let boschId: number;

  test.beforeAll(async () => {
    // Clear existing data to ensure a clean state
    await wipeAll();

    // Create seed partners
    const ford = await prisma.partner.create({
      data: { name: 'Ford', type: { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } }, region: { connectOrCreate: { where: { name: 'AMER' }, create: { name: 'AMER' } } } }
    });
    fordId = ford.id;

    await prisma.partner.create({
      data: { name: 'Toyota', type: { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } }, region: { connectOrCreate: { where: { name: 'AMER' }, create: { name: 'AMER' } } } }
    });

    // /my-projects → /me → the person page; @dylan needs a Person record.
    await prisma.person.create({
      data: { name: 'Dylan Lead', email: 'dylan@google.com', currentPartnerId: ford.id }
    });

    const bosch = await prisma.partner.create({
      data: { name: 'Bosch', type: { connectOrCreate: { where: { name: 'Supplier' }, create: { name: 'Supplier' } } }, region: { connectOrCreate: { where: { name: 'AMER' }, create: { name: 'AMER' } } } }
    });
    boschId = bosch.id;

    // Create a Bosch project to start with
    await prisma.project.create({
      data: {
        name: 'Ford Explorer VHAL Integration (Bosch)',
        partnerId: bosch.id
      }
    });
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test('creates a project from the DB-backed 15-phase AAOS template', async ({ page }) => {
    await page.goto('/programs/new');

    // Templates come from the database (built-ins seeded on demand), not a constant.
    await page.fill('input[name="name"]', 'Ford F-150 AAOS Bring-up');
    await page.selectOption('select[name="partnerId"]', fordId.toString());
    await page.selectOption('select[name="template"]', { label: 'AAOS Bring-up (chipset → GBI)' });
    // Owner is picked from existing people (no freeform text) — value is the email.
    await page.selectOption('select[name="owner"]', 'dylan@google.com');
    // SOP target is REQUIRED at creation (month/year; month-end assumed).
    await page.fill('input[name="sopMonth"]', '2027-06');
    await page.check('input[name="hasGas"]');
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/programs\/\d+/, { timeout: 15000 });

    // The full P0–P14 DAG instantiates — 15 phases, from architecture lock to SOP.
    await expect(page.locator('body')).toContainText('Ford F-150 AAOS Bring-up');
    await expect(page.getByTestId('phase-row')).toHaveCount(15);
    await expect(page.locator('a:text-is("Architecture lock")')).toBeVisible();
    await expect(page.locator('a:text-is("Launch readiness & SOP (GBI)")')).toBeVisible();

    // Durations arrive as weeks (template) × 7 → days, displayed back as weeks.
    const bsp = page.getByTestId('phase-row').filter({ has: page.locator('a:text-is("BSP & power-on")') });
    await expect(bsp).toContainText('18w planned');

    // Template content is copied onto the live phase and shown in its details. The
    // card opens first: MIN is one line (name + plan), so the zoom button that
    // reaches the popover only exists once the card is at standard size.
    const archLock = page.locator('[data-testid="phase-row"]')
      .filter({ has: page.locator('a:text-is("Architecture lock")') });
    await archLock.locator('a[data-card-title]').click();
    await archLock.getByRole('button', { name: 'Details' }).click();
    const details = page.getByTestId('phase-details');
    // Template content copied onto the live phase (Goal/Done-when format since the
    // phase-dossier overhaul, PR #15).
    await expect(details).toContainText('Freeze the platform architecture');
    await expect(details).toContainText('VINTF-compliant posture');

    // leadRole "OEM" resolved unambiguously to the program's OEM partner.
    const project = await prisma.project.findFirst({ where: { name: 'Ford F-150 AAOS Bring-up' } });
    const p0 = await prisma.phase.findFirst({ where: { projectId: project!.id, name: 'Architecture lock' } });
    expect(p0!.leadPartnerId).toBe(fordId);
    const end = await prisma.phase.findFirst({ where: { projectId: project!.id, isEndPhase: true } });
    expect(end!.name).toBe('Launch readiness & SOP (GBI)');
  });

  test('should display user projects on My Projects page', async ({ page }) => {
    // Navigate to My Projects
    await page.goto('/my-projects?user=@dylan');

    // Verify projects owned by @dylan are listed
    await expect(page.locator('body')).toContainText('Ford F-150 AAOS Bring-up');
  });

  test('should list the programs a partner owns on the partner page', async ({ page }) => {
    // Navigate to the Bosch partner page
    await page.goto(`/partners/${boschId}`);

    // The Programs list shows what Bosch owns — a row without "via" attribution.
    await expect(page.locator('h1')).toContainText('Bosch');
    await expect(page.locator('body')).toContainText('Programs');
    const row = page.locator('details').filter({ hasText: 'Ford Explorer VHAL Integration (Bosch)' });
    await expect(row).toBeVisible();
    await expect(row).not.toContainText('via');
  });
});
