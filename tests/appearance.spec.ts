import { test, expect } from '@playwright/test';
import { prisma } from './helpers/db';
import { seedProgram, type SeededProgram } from './helpers/fixtures';

// Appearance is TWO independent axes (design.md §8c): data-style (standard |
// instrument) and data-theme (light | dark, resolved from light | dark | system).
// Four combinations, and the promise is that either can be changed without
// disturbing the other — that promise is what these tests hold.

const STYLE_KEY = 'autoknow-style';
const THEME_KEY = 'autoknow-theme';

const seed = (page: import('@playwright/test').Page, style?: string, theme?: string) =>
  page.addInitScript(
    ([s, t, sk, tk]) => {
      if (s) localStorage.setItem(sk as string, s as string);
      if (t) localStorage.setItem(tk as string, t as string);
    },
    [style, theme, STYLE_KEY, THEME_KEY],
  );

const root = (page: import('@playwright/test').Page) => page.locator('html');

test.describe('Appearance: style and theme are independent', () => {
  let seeded: SeededProgram;

  test.beforeAll(async () => {
    seeded = await seedProgram();
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test('defaults to the instrument style, and an explicit standard survives', async ({ page }) => {
    await page.goto('/');
    // No stored preference must never leave the attribute unset — unset would fall
    // through to whichever tokens sit underneath by luck rather than by decision.
    await expect(root(page)).toHaveAttribute('data-style', 'instrument');

    // Only an EXPLICIT standard opts out, so nobody who chose the old look loses it
    // when the default moves.
    await seed(page, 'standard');
    await page.goto('/');
    await expect(root(page)).toHaveAttribute('data-style', 'standard');
  });

  test('the stored style is applied before first paint, not after hydration', async ({ page }) => {
    await seed(page, 'instrument');
    await page.goto('/');

    // Asserted without waiting for hydration: the inline script in layout.tsx owns
    // this, so a regression that moved it into React would show up as a flash.
    await expect(root(page)).toHaveAttribute('data-style', 'instrument');
    await expect(page.locator('body')).toHaveCSS('font-variant-numeric', 'tabular-nums');
  });

  test('each style carries its own accent, and dark works in both', async ({ page }) => {
    const hue = () =>
      page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--hue').trim());
    const bgLuminance = () =>
      page.evaluate(() => {
        const [r, g, b] = getComputedStyle(document.body)
          .backgroundColor.match(/[\d.]+/g)!
          .slice(0, 3)
          .map((v) => parseFloat(v) / 255)
          .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      });

    await seed(page, 'standard', 'light');
    await page.goto('/');
    expect(await hue()).toBe('142'); // the locked brand green
    expect(await bgLuminance()).toBeGreaterThan(0.5);

    await page.evaluate(() => { document.documentElement.dataset.style = 'instrument'; });
    expect(await hue()).toBe('76'); // pear — the one place the hue moves
    expect(await bgLuminance()).toBeGreaterThan(0.5); // still LIGHT: style ≠ theme

    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    expect(await hue()).toBe('76'); // theme change must not reset the style
    expect(await bgLuminance()).toBeLessThan(0.1);
  });

  test('instrument-only graphics render in both styles but only show in one', async ({ page }) => {
    await seed(page, 'standard');
    await page.goto(`/programs/${seeded.projectId}`); // phases, so hill charts

    // Rendered by both styles on purpose — no hill chart reads the theme in JS.
    const flourishes = page.locator('[data-inst-only]');
    await expect(flourishes.first()).toBeAttached();
    await expect(flourishes.first()).toBeHidden();

    await page.evaluate(() => { document.documentElement.dataset.style = 'instrument'; });
    await expect(flourishes.first()).toBeVisible();
  });

  // A grid that presents two blocks as a matched pair has to build them as one:
  // these headings were a <p><strong> and an <h3>, differing in tag, size, weight
  // AND margin, which put 4px of vertical disagreement between them. Layout is
  // not assertable in a unit test, so it is pinned here.
  test('matched column headings share a baseline', async ({ page }) => {
    await page.goto(`/programs/${seeded.projectId}`);

    const grid = page.locator('[class*="lowerGrid"]');
    await expect(grid).toBeVisible();

    const metrics = await grid.evaluate((el) => {
      const [left, right] = [...el.children] as HTMLElement[];
      const textTop = (col: Element) => {
        const heading = col.firstElementChild!;
        const range = document.createRange();
        range.selectNodeContents(heading);
        return range.getBoundingClientRect().top;
      };
      const box = (col: Element) => {
        const cs = getComputedStyle(col.firstElementChild!);
        return `${col.firstElementChild!.tagName}/${cs.fontSize}/${cs.lineHeight}/${cs.fontWeight}/${cs.marginTop}`;
      };
      return { delta: Math.abs(textTop(left) - textTop(right)), leftBox: box(left), rightBox: box(right) };
    });

    expect(metrics.delta).toBeLessThan(0.5);
    // Same metrics, not merely the same rendered position by luck.
    expect(metrics.leftBox).toBe(metrics.rightBox);
  });

  // The trailing graticule on Instrument headings rests on the text BASELINE, so
  // it sits identically whether the row is a page title (align-items:baseline) or
  // a section h2 (align-items:center). It had been merely centred, landing at a
  // different offset in rows of different height.
  test('heading graticules sit ON the text baseline in every style-instrument heading', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('autoknow-style', 'instrument'));
    await page.goto(`/programs/${seeded.projectId}`);

    // The real invariant is the GAP, not the align-self value: `align-self:
    // baseline` on the graticule silently floated it ~15px high when its row was
    // align-items:center (no sibling baseline to share). So measure the pixels.
    const gaps = await page.evaluate(() => {
      const rows = [
        document.querySelector('[class*="titleRow"]'),
        ...document.querySelectorAll('[class*="AnchorHeading"][class*="row"]'),
      ].filter(Boolean) as HTMLElement[];
      return rows.map((row) => {
        const heading = row.querySelector('h1, h2');
        if (!heading || getComputedStyle(row, '::after').backgroundImage === 'none') return null;
        // true alphabetic baseline via a zero-height inline-block marker
        const marker = document.createElement('span');
        marker.style.cssText = 'display:inline-block;width:1px;height:0;vertical-align:baseline;';
        heading.appendChild(marker);
        const baselineY = marker.getBoundingClientRect().top;
        marker.remove();
        // a stand-in with the graticule's exact geometry to read its bottom
        const a = getComputedStyle(row, '::after');
        const probe = document.createElement('span');
        probe.style.cssText = `flex:1 1 1.5rem;min-width:1.5rem;height:${a.height};margin-left:${a.marginLeft};align-self:${a.alignSelf};`;
        row.appendChild(probe);
        const bottom = probe.getBoundingClientRect().bottom;
        probe.remove();
        return bottom - baselineY;
      }).filter((g): g is number => g !== null);
    });

    expect(gaps.length).toBeGreaterThan(1); // a title AND some h2s
    // Every graticule's bottom lands on the heading baseline (sub-pixel tolerance).
    for (const gap of gaps) expect(Math.abs(gap)).toBeLessThan(1);
  });

  // The schedule is a phase × week STATE GRID (issue #75): state separates by colour
  // + position (on-plan ink, over red, early green, idle amber), with NO hatch/stipple
  // textures and NO full-height buffer bands — the old encoding that was unreadable on
  // a complex chain. Verify the re-encoding landed, from the rendered DOM.
  test('schedule is a textureless state grid, no full-height bands', async ({ page }) => {
    await page.goto(`/programs/${seeded.projectId}`);

    const chart = page.locator('[class*="scheduleSvg"]').first();
    await expect(chart).toBeVisible();

    const info = await chart.evaluate((svg) => {
      const paint = [...svg.querySelectorAll('rect, line, path')]
        .flatMap((el) => [el.getAttribute('fill') ?? '', el.getAttribute('stroke') ?? '']);
      return {
        hasInkCell: paint.some((p) => p.includes('var(--fg)')),        // on-plan state cells
        hasPatternFill: paint.some((p) => p.startsWith('url(#sched')),  // the removed textures
        hasBandToken: paint.some((p) => p.includes('var(--band-')),     // the removed washes
      };
    });

    expect(info.hasInkCell).toBe(true);       // the grid drew state cells
    expect(info.hasPatternFill).toBe(false);  // hatch/stipple textures are gone
    expect(info.hasBandToken).toBe(false);    // full-height buffer washes are gone
  });

  test('the style picker persists the choice', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('user-menu').click();

    await page.getByRole('radio', { name: 'Instrument' }).click();
    await expect(root(page)).toHaveAttribute('data-style', 'instrument');
    expect(await page.evaluate((k) => localStorage.getItem(k), STYLE_KEY)).toBe('instrument');

    await page.reload();
    await expect(root(page)).toHaveAttribute('data-style', 'instrument');

    // And back, so the A/B is genuinely reversible.
    await page.getByTestId('user-menu').click();
    await page.getByRole('radio', { name: 'Standard' }).click();
    await expect(root(page)).toHaveAttribute('data-style', 'standard');
  });
});
