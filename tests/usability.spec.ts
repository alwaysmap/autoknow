import { test, expect } from '@playwright/test';
import { prisma } from './helpers/db';
import { seedProgram, type SeededProgram } from './helpers/fixtures';

// Cross-cutting usability invariants from the 2026-07-20 design pass. Each is a
// rule a human would notice being broken, and each broke at least once this
// session, so it is pinned to the pixels rather than to prose.

test.describe('usability invariants', () => {
  let seeded: SeededProgram;

  test.beforeAll(async () => {
    seeded = await seedProgram();
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test('a CLASS reads as a squared box; a proper-noun entity reads as a rounded pill', async ({ page }) => {
    // Class box — Partner Type / Region on the partners table.
    await page.goto('/partners');
    const box = page.locator('[class*="ClassBox"]').first();
    await expect(box).toBeVisible();
    const boxRadius = await box.evaluate((el) => parseFloat(getComputedStyle(el).borderTopLeftRadius));
    expect(boxRadius, 'class box is squared, not rounded').toBeLessThanOrEqual(6);

    // Pill — the partner/owner names on the program header.
    await page.goto(`/programs/${seeded.projectId}`);
    const pill = page.locator('[class*="pill"]').first();
    await expect(pill).toBeVisible();
    const pillRadius = await pill.evaluate((el) => parseFloat(getComputedStyle(el).borderTopLeftRadius));
    expect(pillRadius, 'proper-noun pill is fully rounded').toBeGreaterThanOrEqual(100);
  });

  test('every search input shares the one rounded shape', async ({ page }) => {
    // A search box should look like a search box wherever you meet it — the
    // Programs filter (SearchField) drifted to a 6px box while the hero was
    // near-pill. Both must now be clearly rounded.
    await page.goto('/programs');
    const filter = page.getByRole('searchbox').first();
    await expect(filter).toBeVisible();
    const filterRadius = await filter.evaluate((el) => parseFloat(getComputedStyle(el).borderTopLeftRadius));
    expect(filterRadius, 'Programs filter is rounded, not the old 6px box').toBeGreaterThanOrEqual(16);

    await page.goto('/');
    const hero = page.getByRole('searchbox').first();
    await expect(hero).toBeVisible();
    const heroRadius = await hero.evaluate((el) => parseFloat(getComputedStyle(el).borderTopLeftRadius));
    expect(heroRadius, 'hero search is rounded').toBeGreaterThanOrEqual(16);
  });

  test('the CTA dial is HIDDEN in Standard despite carrying its own display class', async ({ page }) => {
    // Regression: `[data-inst-only] { display: none }` (0-1-0) tied the dial's own
    // `.gaugeSlot { display: inline-flex }` (0-1-0), and the module CSS loading
    // after globals won the tie — leaking the dial into Standard. The default
    // style IS standard, so this is what most users saw. Caught only because a
    // real browser was on the default style, not the instrument one under test.
    await page.goto('/');

    const displayFor = (style: string) =>
      page.evaluate((s) => {
        document.documentElement.dataset.style = s;
        const slot = document.querySelector('[data-inst-only][class*="gaugeSlot"]');
        return slot ? getComputedStyle(slot).display : 'missing';
      }, style);

    expect(await displayFor('standard'), 'dial hidden in Standard').toBe('none');
    expect(await displayFor('instrument'), 'dial shown in Instrument').not.toBe('none');
  });

  test('the dial reports the SEARCH: it hunts in flight and parks when idle', async ({ page }) => {
    // The dial moved off the CTA and into the field (2026-07-22 user call), and
    // reports a request in flight rather than the pointer. The needle is the REAL
    // gauge path, so a sweep is a change in that path's `d`, not a CSS transform.
    await page.addInitScript(() => localStorage.setItem('autoknow-style', 'instrument'));

    // Hold the response open. A local search answers in single-digit ms, and
    // polling for a window that short is how you write a flake, not a test.
    await page.route('**/api/search**', async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });
    await page.goto('/');

    const needle = page.locator('[class*="InstrumentGauge"] [data-needle]');
    await expect(needle).toBeAttached();
    const rest = await needle.getAttribute('d');
    expect(rest).toBeTruthy();

    // Hovering is NOT a reading any more — the field must stay parked.
    await page.getByRole('searchbox').hover();
    await page.waitForTimeout(300);
    expect(await needle.getAttribute('d')).toBe(rest);

    // Typing starts a request → the needle leaves its stop while it is in flight.
    await expect(async () => {
      await page.getByRole('searchbox').fill('bosch');
      await expect.poll(() => needle.getAttribute('d'), { timeout: 2000 }).not.toBe(rest);
    }).toPass();

    // The answer lands → it settles back to exactly rest. `d` is the assertion
    // because a needle that stops mid-arc is the bug this replaced.
    await expect(page.getByTestId('search-suggest')).toBeVisible({ timeout: 5000 });
    await expect.poll(() => needle.getAttribute('d'), { timeout: 3000 }).toBe(rest);
  });

  test('the hero commits with Enter — it renders no submit button at all', async ({ page }) => {
    // Removing the button is only safe if the keyboard path it replaced works:
    // implicit submission needs the form to hold exactly one field that blocks it,
    // which is a property of the markup and can silently stop being true.
    await page.goto('/');

    const box = page.getByRole('searchbox');
    await expect(box).toBeVisible();
    await expect(page.getByRole('button', { name: /^(Search|Searching…)$/ })).toHaveCount(0);

    await expect(async () => {
      await box.fill('bosch');
      await box.press('Enter');
      await expect(page.getByText(/results? across the ecosystem/)).toBeVisible({ timeout: 3000 });
    }).toPass();
  });

  test('form controls inherit page type, so root scaling reaches them', async ({ page }) => {
    // The UA gives button/input/select/textarea 13.3333px Arial that ignores the
    // root, so a control that does not inherit silently opts out of user font
    // scaling. globals.css resets family + size to inherit.
    await page.goto('/programs');
    const stuck = await page.evaluate(() => {
      const offenders: string[] = [];
      for (const el of document.querySelectorAll('button, input, select, textarea')) {
        const fs = parseFloat(getComputedStyle(el).fontSize);
        if (Math.abs(fs - 13.3333) < 0.01) offenders.push(el.tagName);
      }
      return offenders;
    });
    expect(stuck, 'no control left at the UA default 13.3333px').toEqual([]);
  });
});
