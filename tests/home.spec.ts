import { test, expect } from './helpers/e2e';
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

  // The SOP-at-risk tile deep-links to /programs?sopOutlook=late — the same coupling as
  // above, and the same drift risk: the tile's token must equal the SOP-outlook column's
  // filterValue token, and both are driven by the DETERMINISTIC critical-chain buffer
  // (lib/sop.sopBufferCategory), not the Monte Carlo forecast. Seeds one program whose
  // buffer is exhausted and one with runway to spare, and asserts the click lands on
  // exactly the exhausted one.
  test('the SOP-at-risk tile opens the programs list filtered to the buffer-exhausted programs', async ({ page }) => {
    await wipeAll();
    const DAY = 86_400_000;

    const mkProgramWithSop = async (name: string, partnerName: string, sopDate: Date) => {
      const partner = await prisma.partner.create({ data: { name: partnerName, region } });
      const project = await prisma.project.create({
        data: { name, partnerId: partner.id, hillChartProgress: 30, volumeFirstYear: 1000, sopDate },
      });
      // One in-flight phase → ~48 remaining chain days (60 × 80%).
      const phase = await prisma.phase.create({ data: { name: 'Integration', projectId: project.id, forecastedDuration: 60 } });
      await prisma.phaseState.create({
        data: { phaseId: phase.id, status: 'In Progress', theNeedle: 'On Track', hillChartProgress: 20, notes: 'wip', source: 'testbot' },
      });
    };

    // Active + SOP already in the past → the remaining chain work can't fit: buffer gone.
    await mkProgramWithSop('Late Bring-up', 'Late Partner Co', new Date(Date.now() - 10 * DAY));
    // Active + SOP far in the future → buffer intact.
    await mkProgramWithSop('On-Track Bring-up', 'OnTrack Partner Co', new Date(Date.now() + 800 * DAY));

    await page.goto('/ecosystem');
    const tile = page.getByTestId('sop-risk-stat').getByRole('link');

    await expect(async () => {
      await tile.click({ timeout: 2000 });
      await expect(page).toHaveURL(/\/programs\?sopOutlook=late\b/, { timeout: 2000 });
    }).toPass({ timeout: 20000 });

    await expect(page.getByRole('link', { name: 'Late Bring-up' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'On-Track Bring-up' })).toHaveCount(0);
  });
});
