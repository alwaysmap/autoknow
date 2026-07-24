/** @jest-environment node */
// #33: the horizontal page gutter is ONE shared, responsive token (`--page-gutter`),
// not a value hand-copied into every page container. Before this, the 40px gutter was
// re-declared in eight places and only some shrank on a phone, so page content sat 24px
// further from the edge than the nav brand at 412px (19.4% of the viewport spent on
// margin). This ratchet enforces the fix in software (AGENTS lesson 2), so nobody has to
// REMEMBER that a ninth page must shrink too (lesson 7):
//
//   1. `--page-gutter` is defined ONCE in globals.css — 2.5rem at :root, shrinking to
//      1rem inside the `@media (max-width: 560px)` block (§9's phone breakpoint). Change
//      the gutter in that one place and every page obeys.
//   2. Every page ROOT (the dominant convention: a rule that sets `min-height: 100vh`)
//      draws its horizontal gutter from `var(--page-gutter)`. A new page that hard-codes
//      a bare `2.5rem` gutter — the exact regression #33 undid — fails here.
//
// EXEMPT: a full-viewport page that CENTRES its content (a 404/error card) — its padding
// is a uniform safe-area inset around a centred box, not a left edge shared with the nav.
// The set only grows with a documented reason; a page meant to share the nav's left edge
// is never exempt.
import { readFileSync } from 'node:fs';
import { cssFiles, stripComments } from './helpers/css';

const GLOBALS = 'src/app/globals.css';
const ROOTS = ['src/app', 'src/components'];

// file:selector page roots whose padding is deliberately NOT the shared gutter.
const EXEMPT: ReadonlySet<string> = new Set([
  'src/app/not-found.module.css:.container', // flex-centred 404 card — inset, not a gutter
]);

/** All `.module.css` files under a directory tree. */
const moduleCssFiles = (dir: string): string[] => cssFiles(dir).filter((f) => f.endsWith('.module.css'));

/** Innermost `selector { body }` rules — matches a bare rule and the rule INSIDE a
 *  media query alike (the page-root rules here are flat, never nested further). */
function rules(css: string): Array<{ selector: string; body: string }> {
  const out: Array<{ selector: string; body: string }> = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) out.push({ selector: m[1].trim(), body: m[2] });
  return out;
}

/** The inline (horizontal) padding value of a rule body, or null if it sets none.
 *  Reads `padding-inline` first, else the inline axis of the `padding` shorthand
 *  (1→all, 2→`v h`, 3→`t h b`, 4→`t r b l`). */
function horizontalGutter(body: string): string | null {
  const clean = stripComments(body);
  const pi = /(?:^|[\s;{])padding-inline:\s*([^;]+);/.exec(clean);
  if (pi) {
    const parts = pi[1].trim().split(/\s+/);
    return parts.length === 1 ? parts[0] : parts[1];
  }
  const p = /(?:^|[\s;{])padding:\s*([^;]+);/.exec(clean);
  if (!p) return null;
  const parts = p[1].trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return parts[1]; // 2/3/4-value: the horizontal (right) token
}

describe('the page gutter is one shared, shrinking token (#33)', () => {
  it('defines --page-gutter ONCE in globals.css: 2.5rem base, 1rem at the ≤560px phone breakpoint', () => {
    const css = readFileSync(GLOBALS, 'utf8');
    const root = rules(css).find((r) => r.selector === ':root');
    expect(root).toBeDefined();
    expect(stripComments(root!.body)).toMatch(/--page-gutter:\s*2\.5rem\s*;/);

    // The phone shrink lives in a @media (max-width: 560px) { :root { --page-gutter: 1rem } }
    const phone = /@media\s*\(max-width:\s*560px\)\s*\{[\s\S]*?:root\s*\{([\s\S]*?)\}/.exec(css);
    expect(phone).not.toBeNull();
    expect(phone![1]).toMatch(/--page-gutter:\s*1rem\s*;/);
  });

  it('every page root (min-height: 100vh) draws its horizontal gutter from var(--page-gutter)', () => {
    const offenders: string[] = [];
    for (const file of ROOTS.flatMap(moduleCssFiles)) {
      const css = readFileSync(file, 'utf8');
      for (const { selector, body } of rules(css)) {
        if (!/min-height:\s*100vh/.test(stripComments(body))) continue;
        const key = `${file}:${selector}`;
        if (EXEMPT.has(key)) continue;
        const gutter = horizontalGutter(body);
        if (gutter !== 'var(--page-gutter)') offenders.push(`${key} → ${gutter ?? '(no padding)'}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the exempt list honest — a removed/renamed page root must leave the list', () => {
    const liveKeys = new Set<string>();
    for (const file of ROOTS.flatMap(moduleCssFiles)) {
      const css = readFileSync(file, 'utf8');
      for (const { selector, body } of rules(css)) {
        if (/min-height:\s*100vh/.test(stripComments(body))) liveKeys.add(`${file}:${selector}`);
      }
    }
    expect([...EXEMPT].filter((k) => !liveKeys.has(k))).toEqual([]);
  });
});
