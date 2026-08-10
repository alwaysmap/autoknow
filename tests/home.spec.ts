import { test, expect, clickUntilNavigated } from './helpers/e2e';
import { prisma } from './helpers/db';
import { wipeAll } from './helpers/fixtures';
import type { Health } from '../src/lib/health';

// Two smoke tests, one per surface, after the 2026-07-20 split: `/` is the landing
// page (search is the point), `/ecosystem` is the leadership dashboard that used to
// live at `/`. The dashboard's tile deep-links (relationship-mix, SOP-at-risk) moved
// with it and are exercised against /ecosystem below.

test.describe('Landing page (/)', () => {
  test('leads with search and shows the latest updates', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('searchbox')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Latest updates', exact: true })).toBeVisible();

    // The dashboard moved out; it must not still be rendering here.
    await expect(page.getByRole('heading', { name: 'Programs at Risk', exact: true })).toHaveCount(0);
  });

  test('the nav no longer carries a search box', async ({ page }) => {
    await page.goto('/programs');
    await expect(page.locator('nav').getByRole('searchbox')).toHaveCount(0);
  });
});

test.describe('Ecosystem dashboard (/ecosystem)', () => {
  test.describe.configure({ mode: 'serial' });

  // Every program here needs a partner, and every partner a region (schema.prisma:
  // Partner.regionId is non-optional); the seeding tests below do not vary it, so it
  // is one shape rather than three copies.
  const region = { connectOrCreate: { where: { name: 'AMER' }, create: { name: 'AMER' } } };

  test('renders the leadership dashboard (smoke)', async ({ page }) => {
    await page.goto('/ecosystem');
    await expect(page.getByRole('heading', { name: 'Programs at Risk', exact: true })).toBeVisible();
  });

  // The table's admission rule is a SEMANTIC promise — "Programs at Risk" means
  // currently Concerned, nothing milder — and it lives inline in a client component,
  // so a real render is the only place to hold it. It was silently "Some Risk or
  // worse" until 2026-08-03, with nothing asserting either version.
  test('the risk table shows only currently-Concerned programs', async ({ page }) => {
    await wipeAll();

    const mkProgramAtHealth = async (name: string, partnerName: string, theNeedle: Health) => {
      const partner = await prisma.partner.create({ data: { name: partnerName, region } });
      await prisma.project.create({
        data: { name, partnerId: partner.id, theNeedle, hillChartProgress: 30, volumeFirstYear: 1000 },
      });
    };

    // One program per health state: the one the equality admits, and the two it excludes.
    await mkProgramAtHealth('Concerned Bring-up', 'Concerned Partner Co', 'Concerned');
    await mkProgramAtHealth('Some Risk Bring-up', 'Some Risk Partner Co', 'Some Risk');
    await mkProgramAtHealth('On Track Bring-up', 'On Track Partner Co', 'On Track');

    await page.goto('/ecosystem');
    const riskSection = page.getByRole('heading', { name: 'Programs at Risk', exact: true })
      .locator('xpath=ancestor::section[1]');

    await expect(riskSection.getByRole('link', { name: 'Concerned Bring-up' })).toBeVisible();
    await expect(riskSection.getByRole('link', { name: 'Some Risk Bring-up' })).toHaveCount(0);
    await expect(riskSection.getByRole('link', { name: 'On Track Bring-up' })).toHaveCount(0);
  });

  // The one coupling worth e2e minutes on this page: the relationship-mix tile
  // deep-links into the /partners relationship funnel using the exact canonical token
  // the table filters on ("4", "unrated"). The two sides live in different files, and
  // only a real navigation catches them drifting apart — the same class of bug as
  // free-text entity references (AGENTS lesson 3). Both a rated segment and the
  // "unrated" count are covered because they use different tokens.
  test('relationship-mix links open the partners list filtered to that class', async ({ page }) => {
    await wipeAll();
    const strong = await prisma.partner.create({ data: { name: 'Strong Partner Co', region } });
    const strained = await prisma.partner.create({ data: { name: 'Strained Partner Co', region } });
    // A partner with no state at all — never rated — so the "unrated" link has a target.
    await prisma.partner.create({ data: { name: 'Unrated Partner Co', region } });
    await prisma.partnerState.create({
      data: { partnerId: strong.id, relationshipScore: 4, notes: 'Steady cadence, no escalations.' },
    });
    await prisma.partnerState.create({
      data: { partnerId: strained.id, relationshipScore: 2, notes: 'Two escalations still open.' },
    });

    await page.goto('/ecosystem');
    const segment = page.getByTestId('relationship-mix').getByRole('link', { name: /^Strong —/ });

    // First interaction after a page load is hydration-guarded (AGENTS lesson 8).
    await expect(async () => {
      await segment.click({ timeout: 2000 });
      await expect(page).toHaveURL(/\/partners\?relationship=4\b/, { timeout: 2000 });
    }).toPass({ timeout: 20000 });

    // The funnel resolved to exactly the class the segment stood for.
    await expect(page.getByRole('link', { name: 'Strong Partner Co' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Strained Partner Co' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Unrated Partner Co' })).toHaveCount(0);

    // The "unrated" count is its own door — to the partners still awaiting a first read.
    await page.goto('/ecosystem');
    await page.getByTestId('relationship-mix').getByRole('link', { name: /unrated/ }).click();
    await expect(page).toHaveURL(/\/partners\?relationship=unrated\b/);
    await expect(page.getByRole('link', { name: 'Unrated Partner Co' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Strong Partner Co' })).toHaveCount(0);
  });

  // The SOP-at-risk tile deep-links to the three bad SOP classes at once — the same
  // coupling as above, and the same drift risk: the tile's tokens must equal the
  // SOP-outlook column's filterValue tokens, and both are driven by the DETERMINISTIC
  // critical-chain buffer (lib/sop.sopBufferCategory), not the Monte Carlo forecast.
  //
  // One program per class, because the classes are what the split is FOR: a date already
  // missed, a chain overrunning a date still ahead, and a buffer under the 50%-rule
  // reserve are three different briefings. The third is the regression that matters —
  // under the old `buffer < 0` rule it was counted On Track here while its own program
  // header painted it --warn.
  test('the SOP-at-risk tile opens the programs list filtered to every at-risk class', async ({ page }) => {
    await wipeAll();
    const DAY = 86_400_000;

    const mkProgramWithSop = async (name: string, partnerName: string, sopDate: Date) => {
      const partner = await prisma.partner.create({ data: { name: partnerName, region } });
      const project = await prisma.project.create({
        data: { name, partnerId: partner.id, hillChartProgress: 30, volumeFirstYear: 1000, sopDate },
      });
      // One in-flight phase → ~48 remaining chain days (60 × 80%), so the 50%-rule
      // reserve every SOP below is chosen against is 24 days.
      const phase = await prisma.phase.create({ data: { name: 'Integration', projectId: project.id, forecastedDuration: 60 } });
      await prisma.phaseState.create({
        data: { phaseId: phase.id, status: 'In Progress', theNeedle: 'On Track', hillChartProgress: 20, notes: 'wip', source: 'testbot' },
      });
    };

    // SOP already in the past → blown: a date nobody hit, not a forecast.
    await mkProgramWithSop('Missed Bring-up', 'Missed Partner Co', new Date(Date.now() - 10 * DAY));
    // SOP ahead, but 48 days of work can't fit in 20 → late.
    await mkProgramWithSop('Late Bring-up', 'Late Partner Co', new Date(Date.now() + 20 * DAY));
    // 12 days of buffer against a 24-day reserve → atrisk (positive, and still trouble).
    await mkProgramWithSop('Thin Bring-up', 'Thin Partner Co', new Date(Date.now() + 60 * DAY));
    // Runway to spare → ontrack, and must NOT appear behind the door.
    await mkProgramWithSop('On-Track Bring-up', 'OnTrack Partner Co', new Date(Date.now() + 800 * DAY));

    await page.goto('/ecosystem');
    const tile = page.getByTestId('sop-risk-stat');
    // The figure is the count of exactly the rows the link reveals.
    await expect(tile.getByRole('link')).toHaveText('3');

    await expect(async () => {
      await tile.getByRole('link').click({ timeout: 2000 });
      await expect(page).toHaveURL(/\/programs\?sopOutlook=blown&sopOutlook=late&sopOutlook=atrisk\b/, { timeout: 2000 });
    }).toPass({ timeout: 20000 });

    // Scoped to the TABLE: the timeline above it plots the same filtered set
    // (autoknow-ws1), so an unscoped link-by-name matches the program's mark too.
    const list = page.locator('tbody');
    await expect(list.getByRole('link', { name: 'Missed Bring-up' })).toBeVisible();
    await expect(list.getByRole('link', { name: 'Late Bring-up' })).toBeVisible();
    await expect(list.getByRole('link', { name: 'Thin Bring-up' })).toBeVisible();
    await expect(list.getByRole('link', { name: 'On-Track Bring-up' })).toHaveCount(0);

    // Each class says its own thing in the column — the split is visible, not just
    // internal. Scoped to the ROW: the same labels are also the column funnel's
    // checklist options, so an unscoped getByText matches twice.
    for (const [program, label] of [
      ['Missed Bring-up', 'SOP missed'],
      ['Late Bring-up', 'Forecast late'],
      ['Thin Bring-up', 'Buffer low'],
    ] as const) {
      await expect(page.getByRole('row', { name: new RegExp(program) }).getByText(label)).toBeVisible();
    }
  });

  // The initiatives tile and section (gh-286 part h). The tile's figure counts
  // non-archived initiatives and is a door to /initiatives; the section renders one row
  // per active initiative through the SAME loader the /initiatives page uses, so the
  // two surfaces agree by construction — what this asserts is that /ecosystem actually
  // wires them in, and that archived initiatives reach neither.
  test('the initiatives tile counts active initiatives, links to /initiatives, and the section lists them', async ({ page }) => {
    await wipeAll();

    const partner = await prisma.partner.create({ data: { name: 'Fleet Partner Co', region } });
    // An initiative owns its template snapshot 1:1 (schema: Initiative.templateId is
    // unique) — same shape tests/initiatives.spec.ts drives through the UI.
    const snapshot = await prisma.programTemplate.create({ data: { name: 'Fleet rollout snapshot' } });
    const initiative = await prisma.initiative.create({
      data: { name: 'Gemini across the fleet', templateId: snapshot.id },
    });
    await prisma.initiativePartner.create({ data: { initiativeId: initiative.id, partnerId: partner.id } });
    // The member's copy: no sopDate, so the rollup reads this member "No date".
    await prisma.project.create({
      data: {
        name: 'Gemini across the fleet — Fleet Partner Co',
        partnerId: partner.id,
        initiativeId: initiative.id,
        hillChartProgress: 30,
        volumeFirstYear: 1000,
      },
    });
    // Archived: must count in neither the tile nor the section.
    const retiredSnapshot = await prisma.programTemplate.create({ data: { name: 'Retired snapshot' } });
    await prisma.initiative.create({
      data: { name: 'Retired Fleet Push', templateId: retiredSnapshot.id, isArchived: true },
    });

    await page.goto('/ecosystem');
    const tile = page.getByTestId('initiatives-stat');
    await expect(tile.getByRole('link')).toHaveText('1');

    // The section shows the row — name linked, member count, status distribution — and
    // not the archived initiative.
    const section = page.getByRole('heading', { name: 'Initiatives', exact: true })
      .locator('xpath=ancestor::section[1]');
    await expect(section.getByRole('link', { name: 'Gemini across the fleet' })).toBeVisible();
    await expect(section).toContainText('1 partner');
    await expect(section).toContainText('No date');
    await expect(section).not.toContainText('Retired Fleet Push');

    // The tile is a door. First interaction after the goto, and it navigates — so the
    // hydration guard is clickUntilNavigated, never a bare toPass (qa skill).
    await clickUntilNavigated(page, /\/initiatives$/, () => tile.getByRole('link').click({ timeout: 2000 }));
    await expect(page.getByRole('link', { name: 'Gemini across the fleet' })).toBeVisible();
  });
});
