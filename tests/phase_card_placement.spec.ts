import { test, expect, openCard, closeCard, type Page, type Locator } from './helpers/e2e';
import { prisma } from './helpers/db';
import { seedProgram, type SeededProgram } from './helpers/fixtures';

// WHERE A CARD CLICK LEAVES THE PAGE (autoknow-ff7, autoknow-06t).
//
// The rail's rule is that selecting a phase is a plain selection: the page moves only to
// rescue a card that is not whole on screen, and then by the least that works. Two
// separate things defeated it, and each gets a test here:
//
//   ff7  when it DID move, it moved the maximum — `block: 'start'` lifted the card to the
//        top of the scrollport, so a card clipped by a few pixels at the bottom paid a
//        full-page jump to recover them.
//   06t  the card title is a real `<a href="#phase-:id">`, so activating it ALSO fired the
//        browser's own fragment jump — unconditional, and animated by
//        html { scroll-behavior: smooth }. A card already whole on screen got yanked
//        anyway, by a scroll the component never asked for.
//
// THIS DOES NOT STAGE A RACE. autoknow-dxa deleted an e2e test that tried to catch a
// scroll mid-flight, after three CI failures that were every one a defect in the staging
// rather than in the product. These assert the RESTING position after the page stops
// moving, which is deterministic; the guard that stops a scroll straddling a press is
// unit-tested (tests/useSteadyPageScroll.test.tsx) and enforced statically
// (tests/documentScrollGoesThroughTheGuard.test.ts), not re-litigated here.
//
// Chromium only: placement is CSSOM-View arithmetic over scroll-padding, not an area
// where engines diverge, and webkit's scroll timing is this suite's known flake source
// (ADR: e2e flows only, deliberate matrix).

test.describe('a card click moves the page only as far as it must', () => {
  test.describe.configure({ mode: 'serial' });

  let seeded: SeededProgram;

  test.beforeAll(async () => {
    seeded = await seedProgram();
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  const row = (page: Page, name: string) =>
    page.getByTestId('phase-row').filter({ has: page.locator(`a:text-is("${name}")`) });

  /** The card's box, the viewport, and the clearance the sticky nav reserves — read in
   *  one evaluate so every number describes the same instant. */
  const geometry = (r: Locator) =>
    r.evaluate((el) => {
      const b = el.getBoundingClientRect();
      return {
        top: Math.round(b.top),
        bottom: Math.round(b.bottom),
        height: Math.round(b.height),
        innerHeight: window.innerHeight,
        scrollY: Math.round(window.scrollY),
        clearance: parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0,
      };
    });

  /** Scroll instantly so the card's top edge sits `fromTop` px below the viewport top.
   *  Instant on purpose — this is the test positioning itself, not the behaviour under
   *  test, and an animated setup would be racing the click that follows it. */
  const placeAt = async (page: Page, r: Locator, fromTop: number) => {
    const abs = await r.evaluate((el) => window.scrollY + el.getBoundingClientRect().top);
    await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), abs - fromTop);
  };

  /** Where the page came to rest. Polls until the scroll position holds still, so the
   *  assertion reads the destination rather than a frame on the way to it. */
  const settled = (page: Page) =>
    page.evaluate(async () => {
      let last = -1;
      let same = 0;
      for (let i = 0; i < 200; i += 1) {
        await new Promise((r) => setTimeout(r, 25));
        if (window.scrollY === last) {
          if ((same += 1) > 4) break;
        } else {
          same = 0;
          last = window.scrollY;
        }
      }
      return Math.round(window.scrollY);
    });

  /** Hydration warm-up on a card no assertion here measures. A first interaction after a
   *  page load can land before React attaches, and a swallowed click is never retried by a
   *  plain `click()` (AGENTS lesson 8) — but the guarded retry shape cannot be used on the
   *  MEASURED click, because a second click would move the page a second time and the
   *  delta would describe two gestures. So the retrying happens here, on a card that is
   *  put straight back the way it was found. */
  const warmUp = async (page: Page) => {
    const warm = row(page, 'Bring-up');
    await expect(async () => {
      await openCard(warm);
      await expect(warm.locator('a[data-card-title]')).toHaveAttribute('aria-expanded', 'true', { timeout: 1500 });
    }).toPass({ timeout: 20000 });
    await closeCard(warm);
  };

  test('a card already whole on screen does not move the page at all (06t)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/programs/${seeded.projectId}`);
    await page.getByTestId('phase-row').first().waitFor();
    await warmUp(page);

    const card = row(page, 'Integration');
    const title = card.locator('a[data-card-title]');
    // High in the viewport, clear of the nav, with room below for the card to grow into.
    const { clearance } = await geometry(card);
    await placeAt(page, card, clearance + 40);
    const before = await settled(page);

    await title.click();
    await expect(title).toHaveAttribute('aria-expanded', 'true');
    const after = await settled(page);

    // The whole point: the card grew, and the page stayed exactly where it was. Against
    // the unfixed component this reads 46px high — the fragment jump, firing on a card
    // that needed no rescue. How far it throws the page depends on where the card sat
    // when it was clicked (the bead measured 332px further down a program), which is
    // exactly why the assertion is "did not move" rather than a tolerance.
    expect(after).toBe(before);
    const box = await geometry(card);
    expect(box.top).toBeGreaterThanOrEqual(box.clearance);
    expect(box.bottom).toBeLessThanOrEqual(box.innerHeight);
  });

  test('a card clipped at the bottom is rescued by the smallest move that works (ff7)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/programs/${seeded.projectId}`);
    await page.getByTestId('phase-row').first().waitFor();
    await warmUp(page);

    const card = row(page, 'Integration');
    const title = card.locator('a[data-card-title]');
    // Only the top sliver showing: the card cannot possibly be whole on screen, so the
    // rescue is the branch under test.
    const { innerHeight } = await geometry(card);
    await placeAt(page, card, innerHeight - 40);
    const before = await settled(page);

    await title.click();
    await expect(title).toHaveAttribute('aria-expanded', 'true');
    const after = await settled(page);
    const box = await geometry(card);

    // It moved, and it moved DOWN the document (the card was below the fold).
    expect(after).toBeGreaterThan(before);
    // The rescue worked: the expanded card is whole on screen, clear of the sticky nav.
    expect(box.bottom).toBeLessThanOrEqual(box.innerHeight);
    expect(box.top).toBeGreaterThanOrEqual(box.clearance);
    // …and it is the MINIMUM rescue, not the maximum. `block: 'start'` would have parked
    // the card's top exactly on the clearance line; `nearest` stops as soon as the bottom
    // edge is in, leaving the card low in the viewport. That gap is the fix.
    expect(box.top).toBeGreaterThan(box.clearance + 1);
    // Anti-vacuity: `nearest` degrades to start-alignment for a card TALLER than the
    // viewing region, which would satisfy the assertion above only by accident. If a
    // future fixture grows this card past the viewport, fail here and say why rather
    // than quietly testing nothing.
    expect(box.height).toBeLessThan(box.innerHeight - box.clearance);
  });

  test('the title records the row in the URL without pushing a history entry (06t)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/programs/${seeded.projectId}`);
    await page.getByTestId('phase-row').first().waitFor();
    await warmUp(page);

    const card = row(page, 'Integration');
    const depth = await page.evaluate(() => history.length);
    await card.locator('a[data-card-title]').click();
    await expect(card.locator('a[data-card-title]')).toHaveAttribute('aria-expanded', 'true');

    // The row stays addressable — the href is real and the fragment is written…
    expect(await page.evaluate(() => window.location.hash)).toBe(`#phase-${seeded.phases.integration}`);
    // …but replaceState, not the anchor's default push: which card is open is a mode of
    // this page, and a trail of entries would make Back mean "re-close what I closed".
    expect(await page.evaluate(() => history.length)).toBe(depth);
  });
});
