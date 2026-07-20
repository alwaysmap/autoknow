import { test, expect, type Page } from '@playwright/test';

// Colour contrast, enforced across ALL FOUR appearance combos (2 styles × 2
// themes). This exists because the SAME class of bug shipped THREE times this
// session — kind inks at 1.7:1, the googler pill hover at 2.2:1, and the RAG
// palette before that — each a literal hex chosen against one ground and unread
// on another. Reading the RESOLVED token values from a live page uses the real
// browser cascade, so it cannot drift from what actually renders.
//
// WCAG: 4.5:1 for body text, 3:1 for large text and non-text UI indicators.

const COMBOS = [
  { style: 'standard', theme: 'light' },
  { style: 'standard', theme: 'dark' },
  { style: 'instrument', theme: 'light' },
  { style: 'instrument', theme: 'dark' },
] as const;

/** Relative luminance of a computed `rgb(...)` / `color(...)` string. */
function luminance(color: string): number {
  const nums = color.match(/[\d.]+/g);
  if (!nums) throw new Error(`unparseable colour: ${color}`);
  const [r, g, b] = nums.slice(0, 3).map((v) => {
    const c = parseFloat(v) > 1 ? parseFloat(v) / 255 : parseFloat(v);
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/** Resolve a batch of CSS custom properties to their computed colour, under the
 *  given style+theme, by painting each on a throwaway element (so `color:` does
 *  the var → rgb resolution the same way the app does). */
async function resolveTokens(page: Page, style: string, theme: string, tokens: string[]) {
  return page.evaluate(
    ({ style, theme, tokens }) => {
      document.documentElement.dataset.style = style;
      document.documentElement.dataset.theme = theme;
      const probe = document.createElement('span');
      document.body.appendChild(probe);
      const out: Record<string, string> = {};
      for (const t of tokens) {
        probe.style.color = '';
        probe.style.color = `var(${t})`;
        out[t] = getComputedStyle(probe).color;
      }
      probe.remove();
      return out;
    },
    { style, theme, tokens },
  );
}

// ink → the grounds it must be readable on. `bg` is the page, `paper` the card.
const TEXT_INKS: Record<string, ('bg' | 'paper')[]> = {
  '--fg': ['bg', 'paper'],
  '--muted': ['bg', 'paper'],
  '--link': ['bg', 'paper'],
  '--link-hover': ['bg', 'paper'],
  '--ok': ['bg', 'paper'],
  '--warn': ['bg', 'paper'],
  '--bad': ['bg', 'paper'],
  '--crit': ['bg', 'paper'],
  '--kind-partner': ['bg', 'paper'],
  '--kind-program': ['bg', 'paper'],
  '--kind-person': ['bg', 'paper'],
  '--kind-context': ['bg', 'paper'],
  '--googler': ['bg'],
  '--googler-hover': ['bg'],
};

test.describe('colour contrast holds in every style × theme', () => {
  for (const { style, theme } of COMBOS) {
    test(`${style} / ${theme}: every semantic ink is AA on its ground`, async ({ page }) => {
      await page.goto('/');

      const grounds = await resolveTokens(page, style, theme, ['--bg', '--paper']);
      const bgL = luminance(grounds['--bg']);
      const paperL = luminance(grounds['--paper']);

      const inks = await resolveTokens(page, style, theme, Object.keys(TEXT_INKS));

      const failures: string[] = [];
      for (const [ink, on] of Object.entries(TEXT_INKS)) {
        const inkL = luminance(inks[ink]);
        for (const g of on) {
          const r = ratio(inkL, g === 'bg' ? bgL : paperL);
          if (r < 4.5) failures.push(`${ink} on --${g}: ${r.toFixed(2)} (${inks[ink]})`);
        }
      }
      expect(failures, failures.join('\n')).toEqual([]);
    });
  }

  test('the gauge face stays light in dark themes so the coloured sweep reads', async ({ page }) => {
    await page.goto('/');
    for (const { style } of COMBOS.filter((c) => c.theme === 'dark')) {
      const { '--gauge-face': face } = await resolveTokens(page, style, 'dark', ['--gauge-face']);
      // "light" = clearly above mid-grey; it must NOT follow the page into the dark.
      expect(luminance(face), `${style}/dark gauge face ${face}`).toBeGreaterThan(0.6);
    }
  });
});
