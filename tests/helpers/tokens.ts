// Reading design tokens off a LIVE page, for the e2e ratchets that assert about ink.
//
// Sibling of `./css`, which walks stylesheet TEXT in node; this one needs a browser,
// because the whole point is that the real cascade — not a parse of it — decides what
// `var(--warn)` is. It lives here for the reason that file states: a second hand-rolled
// copy had appeared (AGENTS lesson 7), and the copy had already dropped the reset below.
//
// Assert against what this returns rather than against colours written into a test. A
// literal ink measured against a literal ground agrees with itself and reports a healthy
// number over a wrong drawing
// (docs/knowledge/a-literal-ink-over-a-literal-ground-measures-fine.md).
import type { Page } from './e2e';

/**
 * Resolve CSS custom properties to their computed colour, by painting each on a
 * throwaway element so `color:` does the var → rgb resolution exactly as the app does.
 *
 * `appearance` forces a style+theme when the caller is sweeping combos; omit it to read
 * the page as it currently stands.
 *
 * The `color = ''` reset before each read is load-bearing, not tidiness: `var(--gone)`
 * does not clear the property, so without it a renamed or deleted token silently reports
 * the PREVIOUS token's colour and the assertion passes on a value that no longer exists.
 */
export async function resolveTokens(
  page: Page,
  tokens: string[],
  appearance?: { style: string; theme: string },
): Promise<Record<string, string>> {
  return page.evaluate(
    ({ tokens, appearance }) => {
      if (appearance) {
        document.documentElement.dataset.style = appearance.style;
        document.documentElement.dataset.theme = appearance.theme;
      }
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
    { tokens, appearance },
  );
}
