import { test, expect } from '@playwright/test';
import { prisma } from './helpers/db';
import { seedProgram, type SeededProgram } from './helpers/fixtures';

// Behavioral coverage for the unified activity feed: heterogeneous update kinds render
// as list cards (mini needle / mini hill / context), category chips filter them, and
// items are attributed to their program everywhere except the program's own page.

test.describe('Activity feed', () => {
  test.describe.configure({ mode: 'serial' });

  let seeded: SeededProgram;

  test.beforeAll(async () => {
    seeded = await seedProgram();
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test('ecosystem activity mixes kinds and filters by category chips', async ({ page }) => {
    // The ecosystem feed lives on the home page now (/activity is retired).
    await page.goto('/');

    // All three seeded kinds are present under "All".
    await expect(page.getByText('Weekly update: Concerned')).toBeVisible();
    await expect(page.getByText('Codec delivery plan')).toBeVisible();
    // Items name their program at ecosystem scope.
    await expect(page.getByText('R2 AAOS Bring-up').first()).toBeVisible();

    // Filter to Context: the doc stays, the needle update goes.
    await page.locator('button[class*="ActivityFeed"]').filter({ hasText: 'Context' }).click();
    await expect(page.getByText('Codec delivery plan')).toBeVisible();
    await expect(page.getByText('Weekly update: Concerned')).toHaveCount(0);

    // Filter to Progress (needle changes): the reverse.
    await page.locator('button[class*="ActivityFeed"]').filter({ hasText: 'Progress' }).click();
    await expect(page.getByText('Weekly update: Concerned')).toBeVisible();
    await expect(page.getByText('Codec delivery plan')).toHaveCount(0);

    // Filter to Phases (hill updates): phase state cards appear (title carries derived status).
    await page.locator('button[class*="ActivityFeed"]').filter({ hasText: 'Phases' }).click();
    await expect(page.getByRole('link', { name: 'Integration: In Progress' })).toBeVisible();
    await expect(page.getByText('Weekly update: Concerned')).toHaveCount(0);
  });

  test('the ecosystem strip: big number, capacity chart, high-risk list', async ({ page }) => {
    await page.goto('/');

    // Big Number: 1 active program, 1 all time.
    const stats = page.getByTestId('ecosystem-stats');
    await expect(stats).toContainText('Active programs');
    await expect(stats).toContainText('1 all time');

    // Capacity chart: the seeded program (SOP 2027-03, 150k, GAS) lands on the line.
    const chart = page.getByTestId('capacity-chart');
    await expect(chart).toContainText('Units online over time');
    await expect(chart).toContainText('150k');
    await expect(chart).toContainText('with GAS');

    // Each real SOP date is marked with a dot on its series.
    await expect(chart.locator('[data-testid="sop-dot"]')).toHaveCount(1);

    // Drill-down: a quarter click lists the programs shipping then (SOP 2027-03 → Q1 ’27).
    await page.locator('[data-testid="capacity-quarter"]')
      .filter({ has: page.locator('title', { hasText: 'Q1 ’27' }) })
      .click();
    const dialog = page.getByTestId('capacity-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Shipping in Q1 ’27');
    await expect(dialog.getByRole('link', { name: 'R2 AAOS Bring-up' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Close' }).click();

    // Drill-down: the Big Number opens Programs filtered to active.
    await stats.getByRole('link', { name: '1', exact: true }).click();
    await page.waitForURL('**/programs?filter=active');
    await expect(page.locator('#activeOnly')).toBeChecked();
    await expect(page.locator('body')).toContainText('R2 AAOS Bring-up');
    await page.goBack();

    // High-risk list: Concerned program is ranked; More deep-links to Programs.
    const risk = page.getByTestId('high-risk-programs');
    await expect(risk).toContainText('R2 AAOS Bring-up');
    await expect(risk).toContainText('Concerned');
    await risk.getByRole('link', { name: 'More →' }).click();
    await page.waitForURL('**/programs?minRisk=1&sort=risk');
    await expect(page.locator('body')).toContainText('R2 AAOS Bring-up');
  });

  test('partner-scoped activity attributes items to their program', async ({ page }) => {
    await page.goto(`/partners/${seeded.oemId}`);

    // The weekly update names the program it belongs to (a partner spans many programs).
    const item = page.locator('article').filter({ hasText: 'Weekly update: Concerned' });
    await expect(item).toContainText('R2 AAOS Bring-up');
  });
});
