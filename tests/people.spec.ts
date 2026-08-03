import { test, expect, pickCombobox } from './helpers/e2e';
import { prisma } from './helpers/db';
import { wipeAll } from './helpers/fixtures';

test.describe('People and Biographical History', () => {
  test.describe.configure({ mode: 'serial' });

  let personId: number;
  // Someone whose only employment period has ENDED, so no period covers today. Since
  // #127 E5 that is a renderable state rather than an impossible one — the pages must
  // say nothing about a company rather than fall back to the stale cache.
  let betweenJobsId: number;

  test.beforeAll(async () => {
    // Clean tables
    await wipeAll();
    
    // Clean new Person / Affiliation tables
    await wipeAll();

    // Setup partners
    const ford = await prisma.partner.create({
      data: { name: 'Ford', type: { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } }, region: { connectOrCreate: { where: { name: 'AMER' }, create: { name: 'AMER' } } } }
    });
    const waymo = await prisma.partner.create({
      data: { name: 'Waymo', type: { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } }, region: { connectOrCreate: { where: { name: 'AMER' }, create: { name: 'AMER' } } } }
    });

    // Create a person currently at Waymo, but historically at Ford
    const person = await prisma.person.create({
      data: {
        name: 'Alice Smith',
        email: 'asmith@example.com',
        currentPartnerId: waymo.id,
        notes: 'Lead integration specialist for autonomous compute platforms.'
      }
    });
    personId = person.id;

    // Create historical affiliations
    // Ford: Jan 2025 - Dec 2025
    await prisma.personAffiliation.create({
      data: {
        personId: person.id,
        partnerId: ford.id,
        role: 'Embedded Software Engineer',
        startDate: new Date('2025-01-01T00:00:00Z'),
        endDate: new Date('2025-12-31T23:59:59Z')
      }
    });

    // Waymo: Jan 2026 - Present (endDate is null)
    await prisma.personAffiliation.create({
      data: {
        personId: person.id,
        partnerId: waymo.id,
        role: 'Systems Engineer',
        startDate: new Date('2026-01-01T00:00:00Z')
      }
    });

    // The between-jobs case. `currentPartnerId` still points at Ford — the cache is not
    // maintained on the way out — so any surface reading it would confidently print
    // "Ford". Only the as-of predicate knows she is not there.
    const between = await prisma.person.create({
      data: {
        name: 'Nadia Between',
        email: 'nadia@example.com',
        currentPartnerId: ford.id,
      },
    });
    betweenJobsId = between.id;
    await prisma.personAffiliation.create({
      data: {
        personId: between.id,
        partnerId: ford.id,
        role: 'Validation Engineer',
        startDate: new Date('2021-01-01T00:00:00Z'),
        endDate: new Date('2024-06-01T00:00:00Z'),
      },
    });

    // Create projects for actions
    const fordProject = await prisma.project.create({
      data: { name: 'Ford F-150 AAOS Sync', partnerId: ford.id }
    });
    const fordPhase = await prisma.phase.create({
      data: { name: 'BSP power-on', projectId: fordProject.id }
    });

    const waymoProject = await prisma.project.create({
      data: { name: 'Waymo Gen 6 Integration', partnerId: waymo.id }
    });
    const waymoPhase = await prisma.phase.create({
      data: { name: 'Compute integration', projectId: waymoProject.id }
    });

    // Date the two phases (#127 E11): the Ford phase FINISHED inside the Ford period,
    // the Waymo phase is live. The Programs table anchors each involvement on its
    // phase's window, so the Ford row must label the job held THEN and the Waymo row
    // the job held now — same per-row rule the activity feed already proves below.
    await prisma.phaseState.createMany({
      data: [
        { phaseId: fordPhase.id, status: 'In Progress', hillChartProgress: 30, timestamp: new Date('2025-06-01T00:00:00Z') },
        { phaseId: fordPhase.id, status: 'Done', hillChartProgress: 100, timestamp: new Date('2025-07-01T00:00:00Z') },
        { phaseId: waymoPhase.id, status: 'In Progress', hillChartProgress: 40, timestamp: new Date('2026-02-01T00:00:00Z') },
      ],
    });

    // Create historical ActionItem (created in June 2025 when Alice was at Ford)
    await prisma.actionItem.create({
      data: {
        phaseId: fordPhase.id,
        description: 'Resolve CAN bus packet drops',
        status: 'Completed',
        assignedToPersonId: person.id,
        createdAt: new Date('2025-06-15T12:00:00Z')
      }
    });

    // Create current ActionItem (created in Feb 2026 when Alice is at Waymo)
    await prisma.actionItem.create({
      data: {
        phaseId: waymoPhase.id,
        description: 'Verify redundant power supply config',
        status: 'Pending',
        assignedToPersonId: person.id,
        createdAt: new Date('2026-02-10T09:00:00Z')
      }
    });

    // Two updates SHE wrote, one inside each employment window. `source` is the bare
    // handle the app writes (getCurrentUser().handle) and does not change when she
    // moves — which is why the person feed cannot read her company off it, and has to
    // resolve the period covering each update's own timestamp (#127 E10).
    for (const [projectId, at, notes] of [
      [fordProject.id, '2025-06-20T12:00:00Z', 'Ford-era weekly note'],
      [waymoProject.id, '2026-02-12T12:00:00Z', 'Waymo-era weekly note'],
    ] as const) {
      await prisma.projectState.create({
        data: {
          projectId, theNeedle: 'On Track', hillChartProgress: 40,
          notes, source: 'asmith', timestamp: new Date(at),
        },
      });
    }
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });


  test('lists the programs the person worked on, as links', async ({ page }) => {
    await page.goto(`/people/${personId}`);

    // Programs derive from phase involvement + assigned actions — both appear, linked.
    await expect(page.getByRole('link', { name: 'Ford F-150 AAOS Sync' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Waymo Gen 6 Integration' })).toBeVisible();
    // The action-item prose itself is no longer a person-page concern.
    await expect(page.locator('body')).not.toContainText('Resolve CAN bus packet drops');
  });

  test('each Programs row is labelled with the affiliation held at the time of the involvement', async ({ page }) => {
    await page.goto(`/people/${personId}`);

    // One human, two programs, two employers — the Affiliation column decides per ROW
    // by the phase's window (#127 E11). Both rows reading the current job is #124
    // Class 2 wearing a table. The role strings disambiguate where partner names
    // cannot: each program's name already contains its partner's.
    const programs = page.locator('section', { has: page.locator('#programs') });
    const fordRow = programs.locator('tr', { hasText: 'Ford F-150 AAOS Sync' });
    const waymoRow = programs.locator('tr', { hasText: 'Waymo Gen 6 Integration' });
    await expect(fordRow).toContainText('Embedded Software Engineer');
    await expect(fordRow).not.toContainText('Systems Engineer');
    await expect(waymoRow).toContainText('Systems Engineer');
    await expect(waymoRow).not.toContainText('Embedded Software Engineer');
  });

  test('the activity feed labels each entry with the company held THEN, not today', async ({ page }) => {
    await page.goto(`/people/${personId}`);

    // One human, one feed, two employers — decided per ROW by when each update was
    // written. Reading the same company on both rows is #124 Class 2 back again.
    const feed = page.locator('section', { has: page.locator('#activity') });
    const fordRow = feed.locator('article').filter({ hasText: 'Ford-era weekly note' });
    const waymoRow = feed.locator('article').filter({ hasText: 'Waymo-era weekly note' });
    await expect(fordRow).toContainText('Ford');
    await expect(fordRow).toContainText('Embedded Software Engineer');
    await expect(fordRow).not.toContainText('Waymo');
    await expect(waymoRow).toContainText('Waymo');
    await expect(waymoRow).toContainText('Systems Engineer');

    // The limit is stated on the page rather than left to be inferred from a short list.
    await expect(feed).toContainText('carry no author');
  });

  test('any login can create a Person from the directory kebab', async ({ page }) => {
    await page.goto('/people');

    const dialog = page.locator('dialog[open]');
    await expect(async () => {
      if (!(await dialog.isVisible())) {
        const item = page.getByTestId('new-person');
        if (!(await item.isVisible())) await page.getByTestId('kebab-menu').click({ timeout: 2000 });
        await item.click({ timeout: 2000 });
      }
      await expect(dialog).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 20000 });

    await dialog.locator('#npName').fill('Priya Nair');
    await dialog.locator('#npEmail').fill('priya@ford.example');
    await pickCombobox(dialog, 'New Organization', 'ford', 'Ford');
    await dialog.locator('#npRole').fill('Connectivity Lead');
    await dialog.locator('button:has-text("Save")').last().click();

    await page.waitForURL(/\/people\/\d+/);
    await expect(page.locator('h1')).toContainText('Priya Nair');
    await expect(page.locator('body')).toContainText('Ford');
    await expect(page.locator('body')).toContainText('Connectivity Lead');
  });

  test('a person with no period covering today shows no company, rather than the stale cache', async ({ page }) => {
    await page.goto(`/people/${betweenJobsId}`);

    // The identity line itself, not the page header — the header also contains the
    // kebab's dialogs, whose partner picker lists every partner including Ford.
    const ident = page.locator('[class*="identLine"]');
    await expect(ident).toContainText('nadia@example.com');
    // The cache says Ford. The identity line must not, and must not link to it either —
    // this is the assertion that fails if anyone reintroduces a currentPartner read.
    await expect(ident).not.toContainText('Ford');
    await expect(ident.locator('a[href^="/partners/"]')).toHaveCount(0);
    // Her ENDED Ford period is still history, and still says Ford — the page is silent
    // about today, not about her career.
    await expect(page.locator('body')).toContainText('Validation Engineer');
  });

  test('the directory leaves both company and role blank for that person', async ({ page }) => {
    await page.goto('/people');

    // Company and Role come from ONE row now, so they are blank together. A row naming a
    // company with no role is the half-and-half state #127 E5 removed.
    const row = page.getByRole('row').filter({ hasText: 'Nadia Between' });
    await expect(row).toBeVisible();
    await expect(row).not.toContainText('Ford');
    await expect(row).not.toContainText('Validation Engineer');
  });

  test('a login can assign a person onto a program phase from the kebab', async ({ page }) => {
    await page.goto(`/people/${personId}`);

    const dialog = page.locator('dialog[open]');
    await expect(async () => {
      if (!(await dialog.isVisible())) {
        const item = page.getByTestId('add-to-program');
        if (!(await item.isVisible())) await page.getByTestId('kebab-menu').click({ timeout: 2000 });
        await item.click({ timeout: 2000 });
      }
      await expect(dialog).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 20000 });

    await pickCombobox(dialog, 'Program', 'waymo', 'Waymo Gen 6 Integration');
    await dialog.locator('#assignPhase').selectOption({ label: 'Compute integration' });
    await dialog.locator('#assignRole').fill('Integration lead');
    await dialog.locator('button:has-text("Save")').last().click();
    await expect(page.locator('dialog[open]')).toHaveCount(0);

    // The Programs section now carries the phase chip with the role.
    await expect(page.getByRole('link', { name: /Compute integration/ })).toBeVisible();
    await expect(page.locator('body')).toContainText('Integration lead');
  });

  // #127 E14, spec #124 §3. The dialog says what it is about to DO before it does it,
  // and the date is what changes the answer — the safeguard that keeps a typo fix from
  // writing a fake job change. Runs LAST in this serial file: it schedules a change on
  // the shared person, which the assertions above would otherwise see.
  test('the one editor states correct-vs-change as the effective date changes', async ({ page }) => {
    await page.goto(`/people/${personId}`);

    const dialog = page.locator('dialog[open]');
    await expect(async () => {
      if (!(await dialog.isVisible())) {
        const item = page.getByTestId('edit-person');
        if (!(await item.isVisible())) await page.getByTestId('kebab-menu').click({ timeout: 2000 });
        await item.click({ timeout: 2000 });
      }
      await expect(dialog).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 20000 });

    // Empty date: a correction. The dialog opens seeded with today's employer and
    // title, which is what makes correcting a typo'd title possible at all.
    await expect(dialog).toContainText('corrects');
    // By NAME, not by id: the dialog renders twice on a page with a scheduled change, so
    // its field ids carry a useId() prefix. The name IS the form contract the action
    // parses, which makes it the stable handle.
    await expect(dialog.locator('input[name="role"]')).toHaveValue('Systems Engineer');

    // A future date turns the same submit into a scheduled change — no extra control,
    // only the date.
    const future = new Date();
    future.setUTCFullYear(future.getUTCFullYear() + 1);
    await dialog.locator('input[name="effectiveDate"]').fill(future.toISOString().slice(0, 10));
    await expect(dialog).toContainText('schedules');

    await pickCombobox(dialog, 'Organization', 'ford', 'Ford');
    await dialog.locator('input[name="role"]').fill('Platform Lead');
    await dialog.locator('button:has-text("Save changes")').click();
    await expect(page.locator('dialog[open]')).toHaveCount(0);

    // The scheduled change is VISIBLE — a pending change nobody can see is Class 1 in a
    // new costume — and the identity line still reads the job held TODAY.
    await expect(page.locator('body')).toContainText('Scheduled: moves to Ford');
    await expect(page.locator('[class*="identLine"]')).toContainText('Waymo');

    // …and cancellable, which puts the career back the way it was. By testid, not by
    // text: the Edit dialog is a child of this line and has a Cancel of its own.
    await page.getByTestId('cancel-scheduled').click();
    await expect(page.locator('body')).not.toContainText('Scheduled: moves to Ford');
  });

});
