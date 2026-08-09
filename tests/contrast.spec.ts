import { test, expect, type Page } from './helpers/e2e';

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
  '--kind-initiative': ['bg', 'paper'],
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

  // The ring is drawn INSIDE the focused control (#123), so its ground is whatever
  // that control sits on — a menu row on the panel's --white, the same row hovered
  // on --surface, a page control on --bg. It must clear the 3:1 NON-TEXT floor on
  // all of them: aliasing --p-500 looked fine on --paper and came in at 2.74:1 on
  // --surface, which is a ring you cannot see on the row you are hovering.
  test('the focus ring clears 3:1 on every ground it can land on', async ({ page }) => {
    await page.goto('/');
    const failures: string[] = [];
    for (const { style, theme } of COMBOS) {
      const t = await resolveTokens(page, style, theme, ['--focus-ring', '--bg', '--paper', '--white', '--surface']);
      const ringL = luminance(t['--focus-ring']);
      for (const g of ['--bg', '--paper', '--white', '--surface']) {
        const r = ratio(ringL, luminance(t[g]));
        if (r < 3) failures.push(`${style}/${theme}: ring on ${g}: ${r.toFixed(2)} (${t['--focus-ring']})`);
      }
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });

  // CapacityChart draws the vehicles line and the SOP dots in --fg along the TOP
  // EDGE of the AAOS band, so that band is their ground. Both used to be literals
  // — ink hsl(0, 0%, 25%), band #dcd8cd — and a literal-on-literal pair measures
  // beautifully (7.28:1) in a theme neither belongs to: the dark page had a
  // near-white band, so the mid-grey line read only because the ground was ALSO
  // wrong. Tokenising the ink alone would have swapped one invisible drawing for
  // another (near-white on near-white, 1.21:1), which is why this asserts the
  // PAIR. 3:1, the non-text floor: a stroke and a dot, not type.
  test('the vehicles line reads on the AAOS band it rides on', async ({ page }) => {
    await page.goto('/');
    const failures: string[] = [];
    for (const { style, theme } of COMBOS) {
      const t = await resolveTokens(page, style, theme, ['--fg', '--capacity-aaos']);
      const r = ratio(luminance(t['--fg']), luminance(t['--capacity-aaos']));
      if (r < 3) failures.push(`${style}/${theme}: --fg on --capacity-aaos: ${r.toFixed(2)} (${t['--capacity-aaos']})`);
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });

  // The palette is stated in the LIGHT block and only partly restated in the dark one —
  // two carry their own dark value, three alias tokens that already flip. That split is
  // the fragile part: add a sixth band as a raw literal with no dark partner and it
  // simply keeps its light value on dark paper, which is the exact shape of the bug
  // above. Prose asking the next person to remember is not a mechanism (AGENTS lesson 2),
  // so assert the property instead: every band MOVES between light and dark, however it
  // gets there. This does not care which route a token takes, only that it flips.
  test('every capacity band has a dark value — aliased or its own', async ({ page }) => {
    await page.goto('/');
    const BANDS = ['--capacity-aaos', '--capacity-gbi', '--capacity-gas', '--capacity-dk', '--capacity-aap'];
    const failures: string[] = [];
    for (const { style } of COMBOS.filter((c) => c.theme === 'light')) {
      const light = await resolveTokens(page, style, 'light', BANDS);
      const dark = await resolveTokens(page, style, 'dark', BANDS);
      for (const b of BANDS) {
        if (light[b] === dark[b]) failures.push(`${style}: ${b} is ${light[b]} in BOTH themes — no dark value`);
      }
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });

  test('the gauge face stays light in dark themes so the coloured sweep reads', async ({ page }) => {
    await page.goto('/');
    for (const { style } of COMBOS.filter((c) => c.theme === 'dark')) {
      const { '--gauge-face': face } = await resolveTokens(page, style, 'dark', ['--gauge-face']);
      // "light" = clearly above mid-grey; it must NOT follow the page into the dark.
      expect(luminance(face), `${style}/dark gauge face ${face}`).toBeGreaterThan(0.6);
    }
  });
});
