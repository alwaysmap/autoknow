import { test, expect } from '@playwright/test';
import { prisma } from './helpers/db';
import { seedProgram } from './helpers/fixtures';

// The Critical-chain Schedule used to bind TWO actions to ONE gesture on the row hit
// rect: hover showed the phase status card, click jumped to the phase. On a mouse that
// is fine (hover ≠ click); on TOUCH there is no hover, so a tap synthesized the pointer
// events and then fired click — the card flashed and was destroyed by the jump, leaving
// no way to read a row's card on a phone (issue #22).
//
// The fix splits the two onto two targets: the row BODY reveals the card (never jumps),
// the row LABEL is the jump. This proves it from a TOUCH context — `isMobile` is
// Chromium-only, so this spec is NOT in webkit's testMatch and runs on chromium alone.
test.use({ hasTouch: true, isMobile: true, viewport: { width: 1000, height: 900 } });

test.describe('Chain schedule separates card (tap body) from jump (tap label) on touch (#22)', () => {
  test.describe.configure({ mode: 'serial' });

  let projectId: number;

  test.beforeAll(async () => {
    ({ projectId } = await seedProgram());
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test('tapping the body shows the card without navigating; tapping the label jumps; the card is dismissible', async ({ page }) => {
    await page.goto(`/programs/${projectId}`);

    // Record every phase jump. jumpToPhase dispatches a page-local CustomEvent (no URL
    // change), so listening for it is the deterministic signal that a navigation fired.
    await page.evaluate(() => {
      (window as Window & { __jumps?: number[] }).__jumps = [];
      window.addEventListener('autoknow:jump-phase', (e) => {
        (window as Window & { __jumps?: number[] }).__jumps!.push((e as CustomEvent<number>).detail);
      });
    });
    const jumpCount = () => page.evaluate(() => (window as Window & { __jumps?: number[] }).__jumps!.length);

    const bodies = page.locator('[class*="rowHit"]'); // the plot band — reveals the card
    const labels = page.locator('[class*="rowLabel"]'); // the phase name — the jump
    const card = page.getByTestId('chain-row-card');

    // The first schedule row, and the phase name the card must state.
    await expect(labels.first()).toBeVisible({ timeout: 20000 });
    const name = (await labels.first().textContent())!.trim();

    // 1) TAP THE BODY → the status card opens, and NOTHING navigates. Hydration-guarded
    //    first interaction (the repo's #1 e2e flake source otherwise).
    await expect(async () => {
      await bodies.first().tap();
      await expect(card).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 20000 });
    await expect(card).toContainText(name);
    expect(await jumpCount()).toBe(0); // the body tap did NOT jump — the card survives

    // 2) The card is DISMISSIBLE: a tap away from the chart clears it (the existing
    //    dismiss — a coarse tap synthesizes mouseleave off the chart).
    await page.locator('h2#critical-chain').tap();
    await expect(card).toHaveCount(0);

    // 3) TAP THE LABEL → the jump fires. The label is now reachable (rowHit no longer
    //    covers it) and it opens no card.
    await labels.first().tap();
    await expect.poll(jumpCount, { timeout: 5000 }).toBeGreaterThan(0);
    await expect(card).toHaveCount(0);
  });

  // The reported root cause: rowHit spanned the full chart width INCLUDING the label and
  // was painted after it, so it captured every pointer event over the names — the label's
  // own click/cursor/underline were dead on every device. elementFromPoint at the centre
  // of a label must now resolve to the LABEL (or its transparent hit rect), never rowHit.
  test('elementFromPoint over a row label no longer resolves to rowHit', async ({ page }) => {
    await page.goto(`/programs/${projectId}`);
    const label = page.locator('[class*="rowLabel"]').first();
    await expect(label).toBeVisible({ timeout: 20000 });

    const cls = await label.evaluate((el) => {
      const b = el.getBoundingClientRect();
      const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return (hit as SVGElement | null)?.getAttribute('class') ?? '';
    });
    expect(cls).not.toContain('rowHit');
    expect(cls).toMatch(/rowLabel|labelHit/);
  });
});
