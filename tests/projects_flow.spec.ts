import { test, expect, clickUntilNavigated, openCard, openMenuItemDialog, pickCombobox } from './helpers/e2e';
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

    // /my-projects → /me, which RENDERS the person page; @dylan needs a Person record.
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

  test('the programs list kebab links to the create flow', async ({ page }) => {
    await page.goto('/programs');

    // Hydration-guarded first interaction (the suite's #1 flake source): open the
    // ⋯ menu and click "Create Program", which is a real link to /programs/new. The
    // guard is `clickUntilNavigated` rather than a bare toPass because this one NAVIGATES —
    // see tests/helpers/e2e.ts for what a retry costs once it has.
    const item = page.getByTestId('new-program');
    await clickUntilNavigated(page, /\/programs\/new$/, async () => {
      if (!(await item.isVisible())) await page.getByTestId('kebab-menu').click({ timeout: 2000 });
      await item.click({ timeout: 2000 });
    });

    // Landed on the full-page create form (name + template picker present). The template
    // picker is a `Combobox` now, so it is a `role=combobox` input over a hidden field —
    // asserting the hidden field keeps this about "the form is here" rather than about
    // which control renders it.
    await expect(page.locator('input[name="name"]')).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Program Template (Critical Chain DAG)' })).toBeVisible();
  });

  test('the partner page Programs section creates a program pre-selecting that partner', async ({ page }) => {
    await page.goto(`/partners/${fordId}`);

    // The ⋯ lives in the Programs SECTION heading — scope to that section, since the
    // partner NAME carries its own Edit/Delete ⋯ (two kebabs on this page).
    const programsKebab = page
      .locator('section', { has: page.locator('h2#programs') })
      .getByTestId('kebab-menu');
    const item = page.getByTestId('new-program');
    await clickUntilNavigated(page, new RegExp(`/programs/new\\?partnerId=${fordId}$`), async () => {
      if (!(await item.isVisible())) await programsKebab.click({ timeout: 2000 });
      await item.click({ timeout: 2000 });
    });

    // The deep link pre-selects THIS partner in the create form. Two assertions because the
    // picker is a `Combobox` and they are different claims: the reader SEES the partner (by
    // the label this form composes, name + type), and the form POSTS its id.
    await expect(page.getByRole('combobox', { name: 'Partner (OEM / Supplier)' })).toHaveValue('Ford (OEM)');
    await expect(page.locator('input[type="hidden"][name="partnerId"]')).toHaveValue(String(fordId));
  });

  test('the partner page People section creates a person pre-selecting that partner', async ({ page }) => {
    await page.goto(`/partners/${fordId}`);

    // The People ⋯ rides inside the People SECTION's heading (design.md §8c), which is
    // where the list moved when it became a DataTable (#127 E12) — it used to be the
    // sidebar rail's only kebab. Scoped to that section because the partner title and the
    // Programs heading carry their own.
    const people = page.locator('section').filter({ has: page.locator('h2#people') });
    const dialog = page.locator('dialog[open]');
    await openMenuItemDialog(people.getByTestId('kebab-menu'), page.getByTestId('new-person'), dialog);

    // The New-person dialog opens with THIS partner pre-selected as the organization.
    // Two assertions because the picker is a Combobox (gh-269) and they are different
    // claims: the reader SEES the partner's name, and the form POSTS its id.
    await expect(dialog.locator('#npPartner')).toHaveValue('Ford');
    await expect(dialog.locator('input[type="hidden"][name="partnerId"]')).toHaveValue(String(fordId));
  });

  test('creates a project from the DB-backed 15-phase AAOS template', async ({ page }) => {
    await page.goto('/programs/new');

    // Templates come from the database (built-ins seeded on demand), not a constant.
    await page.fill('input[name="name"]', 'Ford F-150 AAOS Bring-up');
    // All three are Comboboxes now (gh-269). The partner label carries its TYPE and the
    // owner label its ADDRESS, so the option text is not the bare name in either case.
    const form = page.locator('form');
    await pickCombobox(form, 'Partner (OEM / Supplier)', 'Ford (OEM)');
    await pickCombobox(form, 'Program Template (Critical Chain DAG)', 'AAOS Bring-up (chipset → GBI)');
    await pickCombobox(form, 'Googler Owner', 'Dylan Lead (dylan@google.com)');
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

    // Template content is copied onto the live phase and READ ON THE CARD — the Goal &
    // definition of done is the card's left column now (autoknow-crw.2), so this no
    // longer opens anything. MIN is one line, so the card is expanded first.
    const archLock = page.locator('[data-testid="phase-row"]')
      .filter({ has: page.locator('a:text-is("Architecture lock")') });
    await openCard(archLock);
    // Template content copied onto the live phase (Goal/Done-when format since the
    // phase-dossier overhaul, PR #15).
    await expect(archLock).toContainText('Freeze the platform architecture');
    await expect(archLock).toContainText('VINTF-compliant posture');

    // leadRole "OEM" resolved unambiguously to the program's OEM partner.
    const project = await prisma.project.findFirst({ where: { name: 'Ford F-150 AAOS Bring-up' } });

    // The form DUAL-WRITES the owner (#127 E6): the email that the picker submitted AND
    // the person it names. This is the only owner-writing path the unit tests do not
    // reach, and an id missing here means the seam that makes writing one column without
    // the other impossible has a hole on the surface a human actually uses.
    // `findFirst`, not `findUnique`: `Person.email` lost `@unique` at #127 E9 — the seed
    // still gives this address to exactly one person, so the assertion is unchanged.
    const owner = await prisma.person.findFirstOrThrow({ where: { email: 'dylan@google.com' } });
    expect(project!.ownerName).toBe('dylan@google.com');
    expect(project!.ownerPersonId).toBe(owner.id);

    // Same pair on the action item the first phase gets — that path used to write the
    // text alone (AGENTS lesson 7: the same defect, one model over).
    const firstAction = await prisma.actionItem.findFirstOrThrow({
      where: { phase: { projectId: project!.id } },
    });
    expect(firstAction.assignedTo).toBe('dylan@google.com');
    expect(firstAction.assignedToPersonId).toBe(owner.id);

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
