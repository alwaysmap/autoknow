import { test, expect } from './helpers/e2e';
import { prisma } from './helpers/db';
import { seedProgram, type SeededProgram } from './helpers/fixtures';

// The /programs timeline tracks the table (autoknow-ws1, #159's second surface): chart
// and table read ONE predicate (lib/tableFilter), and this flow proves the WIRING end to
// end — narrow the table in a real browser and the chart narrows with it, live. The
// predicate's semantics (OR/AND, derived values, text narrowing) are pinned in
// tests/tableFilter.test.ts; re-running them per engine is what the e2e ADR forbids.

test.describe('Programs timeline tracks the table', () => {
  let seeded: SeededProgram;

  test.beforeAll(async () => {
    seeded = await seedProgram();
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test('filtering the table filters the chart with it', async ({ page }) => {
    await page.goto('/programs');

    // The chart section is the one holding the timeline heading; the table is its own
    // section below. Both link the program's page, so every mark/row assertion scopes
    // to its section rather than trusting the href to be unique on the page.
    const chart = page.locator('section', { has: page.locator('h2#timeline') });
    const markFor = (id: number) => chart.locator(`a[href="/programs/${id}"]`);

    // The seeded program plots as one mark — a real link, not a hit-rect.
    await expect(markFor(seeded.projectId)).toHaveCount(1);

    // First interaction after load is hydration-guarded (qa rule): a keystroke into an
    // unhydrated box is silently lost, so fill-and-assert retries as one unit.
    const box = page.getByPlaceholder('Filter programs…');
    await expect(async () => {
      await box.fill('no-such-program');
      await expect(chart.getByText('No programs to plot yet.')).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 20000 });

    // The table emptied on the same keystroke — one predicate, two surfaces agreeing.
    await expect(page.getByText('No programs match current filters.')).toBeVisible();

    // Narrowing back to a matching prefix restores the mark without a reload.
    await box.fill('R2');
    await expect(markFor(seeded.projectId)).toHaveCount(1);
  });
});
