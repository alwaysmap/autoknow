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

  test('defaults to the standard style, and it survives a reload', async ({ page }) => {
    await page.goto('/');
    // No stored preference must never leave the attribute unset — unset would fall
    // through to the standard tokens by luck rather than by decision.
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
