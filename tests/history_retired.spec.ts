import { test, expect } from '@playwright/test';
import { prisma } from './helpers/db';
import { seedProgram, type SeededProgram } from './helpers/fixtures';

// The standalone /history pages are gone: programs and partners lost theirs on
// 2026-07-20 (the needle log became a popup on the entity's own page), phases on
// 2026-07-21 (the DETAILS popover on the program page). A popover only replaces a
// page if it keeps the two properties the page had, so this spec pins both:
//
//   1. it is REACHABLE BY URL — /programs/:id#phase-:phaseId-detail opens it, and
//      opening it writes that fragment, so what you're reading can be shared;
//   2. it holds the COMPLETE log — the program page preloads only the 6 newest
//      updates per phase, and the popover pulls the rest on demand. Without this
//      the retirement would have quietly dropped every older update.
//
// The needle popup's own deep link is covered by needle.spec.ts.

// Comfortably past the 6-state-per-phase preload, so an excerpt cannot pass.
const OLDER = 9;

test.describe('Retired history pages', () => {
  test.describe.configure({ mode: 'serial' });

  let seeded: SeededProgram;

  test.beforeAll(async () => {
    seeded = await seedProgram();
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test('a phase URL is the popover, not a page — and the old page is gone', async ({ page }) => {
    for (const path of [
      `/history/phase/${seeded.phases.integration}`,
      `/history/project/${seeded.projectId}`,
      `/history/partner/${seeded.oemId}`,
    ]) {
      const res = await page.goto(path);
      expect(res?.status(), `${path} should not resolve`).toBe(404);
    }

    // What replaced it: the same record, deep-linked on the program page. Generous
    // budget — the popover opens from an effect after hydration, so a cold
    // dev-server compile of /programs/[id] lands inside this wait.
    await page.goto(`/programs/${seeded.projectId}#phase-${seeded.phases.integration}-detail`);
    const details = page.getByTestId('phase-details');
    await expect(details).toBeVisible({ timeout: 20000 });
    await expect(details.getByRole('heading', { name: 'Integration' })).toBeVisible();
    await expect(details).toContainText('Codec drops blocking the DSP path');

    // Closing takes the fragment back off: the URL never claims an open popover.
    // (The ✕ is a sibling of the details pane, so it scopes to the dialog.)
    await page.getByRole('dialog', { name: 'Integration' }).getByRole('button', { name: 'Close' }).click();
    await expect(details).toHaveCount(0);
    await expect.poll(() => new URL(page.url()).hash).toBe('');
  });

  test('the popover carries every update, and opening it writes the URL', async ({ page }) => {
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
    const details = page.getByTestId('phase-details');
    // Hydration-resilient open (phase_graph.spec.ts): only click while closed — a
    // late-opening popover scrims the button and a blind retry would hang on it.
    await expect(async () => {
      if (!(await details.isVisible())) {
        await row.getByRole('button', { name: 'Details' }).click({ timeout: 2000 });
      }
      await expect(details).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 20000 });

    // Opening writes the fragment, so the open popover is a shareable URL.
    await expect
      .poll(() => new URL(page.url()).hash)
      .toBe(`#phase-${seeded.phases.integration}-detail`);

    // Every update, including the ones past the page's 6-state preload, arrives.
    for (let i = 0; i < OLDER; i++) {
      await expect(details).toContainText(`Older update ${i}`, { timeout: 10000 });
    }
  });
});
