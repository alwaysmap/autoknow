import { test, expect } from '@playwright/test';
import { prisma } from './helpers/db';
import { wipeAll } from './helpers/fixtures';

// One smoke test: the home dashboard boots and shows its leadership surface.
// Static-content assertions beyond this belong in unit tests or design review —
// e2e minutes are for user/system interaction flows.
test.describe('Home Page (Dashboard)', () => {
  test.describe.configure({ mode: 'serial' });

  test('renders the leadership dashboard (smoke)', async ({ page }) => {
    await page.goto('/');
    const searchInput = page.locator('input[type="search"], input[placeholder*="Search"]').first();
    await expect(searchInput).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Programs at Risk', exact: true })).toBeVisible();
  });

  // The one coupling worth e2e minutes on this page: the relationship-mix tile
  // deep-links into the /partners relationship funnel using the exact canonical token
  // the table filters on ("4", "unrated"). The two sides live in different files, and
  // only a real navigation catches them drifting apart — the same class of bug as
  // free-text entity references (AGENTS lesson 3). Both a rated segment and the
  // "unrated" count are covered because they use different tokens.
  test('relationship-mix links open the partners list filtered to that class', async ({ page }) => {
    await wipeAll();
    const region = { connectOrCreate: { where: { name: 'AMER' }, create: { name: 'AMER' } } };
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

    await page.goto('/');
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
    await page.goto('/');
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
    const region = { connectOrCreate: { where: { name: 'AMER' }, create: { name: 'AMER' } } };
    const DAY = 86_400_000;

    const mkProgram = async (name: string, partnerName: string, sopDate: Date) => {
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
    await mkProgram('Late Bring-up', 'Late Partner Co', new Date(Date.now() - 10 * DAY));
    // Active + SOP far in the future → buffer intact.
    await mkProgram('On-Track Bring-up', 'OnTrack Partner Co', new Date(Date.now() + 800 * DAY));

    await page.goto('/');
    const tile = page.getByTestId('sop-risk-stat').getByRole('link');

    await expect(async () => {
      await tile.click({ timeout: 2000 });
      await expect(page).toHaveURL(/\/programs\?sopOutlook=late\b/, { timeout: 2000 });
    }).toPass({ timeout: 20000 });

    await expect(page.getByRole('link', { name: 'Late Bring-up' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'On-Track Bring-up' })).toHaveCount(0);
  });
});
