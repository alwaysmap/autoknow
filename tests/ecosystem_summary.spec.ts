import { test, expect, clickUntilNavigated, openMenu } from './helpers/e2e';
import { prisma } from './helpers/db';
import { wipeAll } from './helpers/fixtures';

test.describe('Ecosystem Summary Page (Deterministic + AI)', () => {
  test.describe.configure({ mode: 'serial' });

  let projectId: number;
  let ownerId: number;

  test.beforeAll(async () => {
    // Clear and seed a simple project to test status updates
    await wipeAll();

    const partner = await prisma.partner.create({
      data: { name: 'Waymo', type: { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } }, region: { connectOrCreate: { where: { name: 'AMER' }, create: { name: 'AMER' } } } }
    });

    // The owner as a real Person: since #127 E7 the owner column and its funnel read
    // `Project.ownerPersonId`, so a program carrying only the legacy text has no owner
    // to show or filter by.
    const owner = await prisma.person.create({
      data: { name: 'Dylan', email: 'dylan@google.com', currentPartnerId: partner.id },
    });
    ownerId = owner.id;

    const project = await prisma.project.create({
      data: {
        name: 'Waymo Generation 6 AAOS',
        partnerId: partner.id,
        // Both columns, as every write path produces them (lib/owner.requireOwner).
        ownerName: 'dylan@google.com',
        ownerPersonId: owner.id,
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

    // An initiative with one active member for the #initiatives section
    // (autoknow-hcz.12) — same shape as tests/home.spec.ts's part-h fixture. The
    // member's copy carries no sopDate, so the rollup reads it "No date". The copy has
    // initiativeId set, which keeps it OUT of the launches table and the constraint
    // diagnosis (gh-286 decision 5), so the assertions above stay untouched.
    const snapshot = await prisma.programTemplate.create({ data: { name: 'Fleet rollout snapshot' } });
    const initiative = await prisma.initiative.create({
      data: { name: 'Gemini across the fleet', templateId: snapshot.id },
    });
    await prisma.initiativePartner.create({ data: { initiativeId: initiative.id, partnerId: partner.id } });
    await prisma.project.create({
      data: {
        name: 'Gemini across the fleet — Waymo',
        partnerId: partner.id,
        initiativeId: initiative.id,
        hillChartProgress: 30,
        volumeFirstYear: 1000,
      },
    });
    // Archived: must reach neither this page's section nor /initiatives.
    const retiredSnapshot = await prisma.programTemplate.create({ data: { name: 'Retired snapshot' } });
    await prisma.initiative.create({
      data: { name: 'Retired Fleet Push', templateId: retiredSnapshot.id, isArchived: true },
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
    // Hydration-guarded first interaction (the repo's #1 e2e flake source otherwise —
    // qa skill): an unguarded click can land before React attaches the popover handler,
    // and the .check() below then waits forever for a panel that never opened. This is
    // exactly how this spec failed in CI (gh-288's chromium run).
    const ownerFunnel = page.getByRole('button', { name: /^filter owner$/i });
    const ownerCheckbox = page.getByRole('checkbox', { name: 'Dylan' });
    await expect(async () => {
      if (!(await ownerCheckbox.isVisible())) await ownerFunnel.click({ timeout: 2000 });
      await expect(ownerCheckbox).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 20000 });
    await ownerCheckbox.check();
    // The funnel's VALUE is the owner's person id, not their address (#127 E7,
    // design.md §6): the id is the canonical key, and an address is a property of a job
    // that one human can hold several of. The LABEL stays their name, which is what the
    // checkbox above is found by.
    await expect(page).toHaveURL(new RegExp(`owner=${ownerId}(&|$)`));
    await expect(page.locator('body')).toContainText('Waymo Generation 6 AAOS');

    await page.getByRole('button', { name: /clear filters/i }).click();
    await expect(page).not.toHaveURL(/owner=/);

    // A NON-matching deep link, so the assertion means something: this fixture has one
    // program, so "still visible" is true either way and only a disappearance proves the
    // filter ran. Cold load, so the server-side parseFilterParams path is the one tested.
    //
    // Scoped to the launches table, NOT the body: the Flow Constraint panel above also
    // names this program, so a page-wide "not visible" would fail while the filter is
    // working perfectly — which is exactly what it did on first run.
    const launches = page.locator('section', { hasText: 'Program Lifecycle & Launches' }).last();
    // A person id nothing owns — the cold-load equivalent of the old 'NoSuchOwner'.
    await page.goto(`/ecosystem-summary?owner=${ownerId + 9999}`);
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

  // The #initiatives section (autoknow-hcz.12): rows through getInitiativesList — the
  // SAME loader /initiatives renders — so the two surfaces agree by construction (the
  // summary-count ADR). What this asserts is that this page actually wires the section
  // in, that its counts equal /initiatives' row for the same initiative, and that an
  // archived initiative reaches neither surface.
  test('the initiatives section lists active initiatives with the counts /initiatives shows', async ({ page }) => {
    await page.goto('/ecosystem-summary');

    const section = page.getByRole('heading', { name: 'Initiatives', exact: true })
      .locator('xpath=ancestor::section[1]');
    const summaryRow = section.getByRole('row', { name: /Gemini across the fleet/ });
    await expect(summaryRow.getByRole('link', { name: 'Gemini across the fleet' })).toBeVisible();
    // One active member, read "No date" (the copy has no sopDate) — the same counts
    // asserted against /initiatives below. The count targets its CELL, exact: a row-wide
    // toContainText('1') would still pass on a 10 or a date containing a 1.
    await expect(summaryRow.getByRole('cell', { name: '1', exact: true })).toBeVisible();
    await expect(summaryRow).toContainText('No date');
    await expect(section).not.toContainText('Retired Fleet Push');

    // The section's kebab is a door to the full listing. First interaction after the
    // goto, and it navigates — clickUntilNavigated, with the WHOLE menu walk inside
    // open(): a link activation inside AnchoredPopover DISMISSES the panel (the
    // navigation-dismiss ADR) whether or not the client navigation lands, so a retry
    // that only re-clicks the item finds it hidden after a slow first activation and
    // strands — openMenu inside the loop re-opens instead.
    //
    // The item is role=MENUITEM, never 'link': the open panel enhances its items
    // (AnchoredPopover variant='menu'), so a 'link' lookup matches only in the sliver
    // before the toggle handler runs — it passed on fast runs and failed under the
    // 3-file load, which is how the trace caught it.
    const kebab = section.getByRole('button', { name: 'More actions' });
    const doorItem = page.getByRole('menuitem', { name: 'Initiatives', exact: true });
    await clickUntilNavigated(page, /\/initiatives$/, async () => {
      await openMenu(kebab, doorItem);
      // Not clickMenuItem: its unbounded item.click() would spend the loop's whole
      // 20s budget if the panel dismisses between the open and the click, where this
      // 2s bound hands the failure back to clickUntilNavigated to retry.
      await doorItem.click({ timeout: 2000 });
    });

    // /initiatives shows the SAME row: same member count, same distribution reading.
    const listRow = page.getByRole('row', { name: /Gemini across the fleet/ });
    await expect(listRow.getByRole('cell', { name: '1', exact: true })).toBeVisible();
    await expect(listRow).toContainText('No date');
    await expect(page.locator('body')).not.toContainText('Retired Fleet Push');
  });
});
