import { test, expect, openProgressView } from './helpers/e2e';
import { prisma } from './helpers/db';
import { seedProgram, type SeededProgram } from './helpers/fixtures';

// A PHASE'S HOME, AND WHAT IS LEFT OF THE THINGS THAT USED TO BE IT.
//
// Three surfaces have now held a phase's record, and each retirement had to keep the
// properties the last one had:
//
//   /history/phase/:id     a standalone page          retired 2026-07-21
//   #phase-:id-detail      the focused popover        retired by autoknow-crw.4
//   #phase-:id             the CARD on the rail       current
//
// This spec used to be called "a phase URL is the popover, not a page". autoknow-crw.4
// makes that false, so it states the new truth rather than being deleted — the value
// was never the popover, it was the two properties a page has that a modal can lose:
//
//   1. REACHABLE BY URL — a phase link lands on the phase's record, and what you are
//      reading can be shared back;
//   2. the COMPLETE log — the program page preloads only the 6 newest updates per
//      phase, and the record pulls the rest on demand. Without this, each retirement
//      would have quietly dropped every older update.
//
// The needle popup's own deep link is covered by needle.spec.ts.

// Comfortably past the 6-state-per-phase preload, so an excerpt cannot pass.
const OLDER = 9;

test.describe('Retired phase surfaces', () => {
  test.describe.configure({ mode: 'serial' });

  let seeded: SeededProgram;

  test.beforeAll(async () => {
    seeded = await seedProgram();
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test('the old /history pages are gone, and the retired popover URL lands on the card', async ({ page }) => {
    for (const path of [
      `/history/phase/${seeded.phases.integration}`,
      `/history/project/${seeded.projectId}`,
      `/history/partner/${seeded.oemId}`,
    ]) {
      const res = await page.goto(path);
      expect(res?.status(), `${path} should not resolve`).toBe(404);
    }

    // A fragment cannot 404 the way a route can, so the retired popover URL is
    // CANONICALISED instead of ignored: old briefs and shared links still carry it, it
    // named the phase's whole record, and the card is what holds that record now.
    // Generous budget — the fragment is read from an effect after hydration.
    await page.goto(`/programs/${seeded.projectId}#phase-${seeded.phases.integration}-detail`);
    const row = page.getByTestId('phase-row').filter({ has: page.locator('a:text-is("Integration")') });
    await expect(row.locator('a[data-card-title]')).toHaveAttribute('aria-expanded', 'true', { timeout: 20000 });

    // It lands on the phase's record, and the record is READ without opening anything:
    // the goal and the latest update are on the card itself (autoknow-crw.2).
    await expect(row).toContainText('The codec path is stable on the target board');
    await expect(row).toContainText('Codec drops blocking the DSP path');

    // …and the URL is rewritten to the phase's current address, so what the reader
    // ended up on is what they can share again.
    await expect.poll(() => new URL(page.url()).hash).toBe(`#phase-${seeded.phases.integration}`);
  });

  test('a bare phase fragment opens that phase, rather than merely scrolling to it', async ({ page }) => {
    // Every card rests collapsed, so a fragment that only scrolled would land the
    // reader on a one-line header — the "lossy preview" this epic set out to remove.
    await page.goto(`/programs/${seeded.projectId}#phase-${seeded.phases.audio}`);
    const row = page.getByTestId('phase-row').filter({ has: page.locator('a:text-is("Audio")') });
    await expect(row.locator('a[data-card-title]')).toHaveAttribute('aria-expanded', 'true', { timeout: 20000 });
  });

  test('the progress view carries every update, and is its own URL', async ({ page }) => {
    const base = Date.now() - OLDER * 86_400_000;
    for (let i = 0; i < OLDER; i++) {
      await prisma.phaseState.create({
        data: {
          phaseId: seeded.phases.integration,
          status: 'In Progress',
          theNeedle: 'On Track',
          hillChartProgress: 10 + i,
          notes: `Older update ${i}`,
          source: 'testbot',
          timestamp: new Date(base + i * 3_600_000),
        },
      });
    }

    await page.goto(`/programs/${seeded.projectId}`);
    const row = page.getByTestId('phase-row').filter({ has: page.locator('a:text-is("Integration")') });
    await openProgressView(page, row);

    // Opening writes the fragment, so an open log is a shareable URL — the property
    // the standalone page had, kept across two retirements.
    await expect
      .poll(() => new URL(page.url()).hash)
      .toBe(`#phase-${seeded.phases.integration}-progress`);

    // Every update, including the ones past the page's 6-state preload, arrives.
    const view = page.getByTestId('phase-progress');
    for (let i = 0; i < OLDER; i++) {
      await expect(view).toContainText(`Older update ${i}`, { timeout: 10000 });
    }

    // Closing falls back to the phase's own anchor rather than to nothing: the card
    // underneath is still what you are looking at.
    await page.keyboard.press('Escape');
    await expect(view).toHaveCount(0);
    await expect.poll(() => new URL(page.url()).hash).toBe(`#phase-${seeded.phases.integration}`);
  });

  test('arriving at the progress fragment opens the log directly', async ({ page }) => {
    await page.goto(`/programs/${seeded.projectId}#phase-${seeded.phases.integration}-progress`);
    await expect(page.getByTestId('phase-progress')).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('heading', { name: 'Integration' })).toBeVisible();
  });
});
