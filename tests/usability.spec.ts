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

  test('the CTA dial sweeps on HOVER and when autosuggest appears, then returns', async ({ page }) => {
    // The dial is the Instrument style's one motion, and it is an affordance on
    // the button — driven by hover (2026-07-20 user call), and lit as soon as
    // suggestions appear even without a hover. The needle is the REAL gauge path,
    // so a sweep is a change in that path's `d`, not a CSS transform.
    await page.addInitScript(() => localStorage.setItem('autoknow-style', 'instrument'));
    await page.goto('/');

    const needle = page.locator('[class*="InstrumentGauge"] [data-needle]');
    await expect(needle).toBeAttached();
    const rest = await needle.getAttribute('d');
    expect(rest).toBeTruthy();

    // Hover the CTA → the needle leaves its rest position.
    await page.getByRole('button', { name: /^Search$/ }).hover();
    await expect.poll(() => needle.getAttribute('d')).not.toBe(rest);

    // Move away → it settles back to exactly rest.
    await page.mouse.move(2, 2);
    await expect.poll(() => needle.getAttribute('d'), { timeout: 2500 }).toBe(rest);

    // Autosuggest appearing drives it too, with no hover.
    await page.getByRole('searchbox').fill('bosch');
    await expect(page.getByTestId('search-suggest')).toBeVisible();
    await expect.poll(() => needle.getAttribute('d')).not.toBe(rest);
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
