/** @jest-environment node */
// Issue #123: the ⋯ menu painted the BROWSER's focus ring (blue on macOS, a 5px
// amber halo elsewhere) and the popover panel's `overflow: auto` clipped it to a
// single edge — one orphaned line lying across the menu. Two rules came out of it,
// and this ratchet enforces both so neither needs memory (AGENTS lesson 2):
//
//   1. THE RING IS DRAWN INWARD. An outline painted outside the border box is
//      clipped by any ancestor `overflow`, and a container cannot be relied on to
//      reserve room for it — the panel left 4px and the ring wanted more. A focus
//      rule with a POSITIVE `outline-offset` puts the ring back outside the box and
//      re-opens the defect, so it fails here.
//   2. NOBODY SILENTLY DELETES A RING. `outline: none` on a focusable control makes
//      keyboard focus invisible (WCAG 2.4.7); three filter buttons shipped that way.
//      A rule that genuinely must suppress it says so with a `focus-ring-exception:`
//      comment naming the reason, in the rule or in the comment directly above it.
//
// Both checks read CSS text rather than a rendered page on purpose: they are about
// what is AUTHORED. That the ring then renders unclipped is a separate claim, proved
// by screenshot (AGENTS lesson 18), not by counting declarations.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SRC = 'src';
const GLOBALS = 'src/app/globals.css';
const MARKER = 'focus-ring-exception:';

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return cssFiles(p);
    return e.name.endsWith('.css') ? [p] : [];
  });
}

/** The rule a declaration at `at` sits in: its block body, plus the selector and any
 *  comment directly above it (everything since the previous rule closed). */
function enclosingRule(css: string, at: number): { head: string; body: string } {
  const open = css.lastIndexOf('{', at);
  const prevClose = css.lastIndexOf('}', open);
  const close = css.indexOf('}', at);
  return {
    head: css.slice(prevClose + 1, open),
    body: css.slice(open + 1, close < 0 ? css.length : close),
  };
}

function scan(re: RegExp, keep: (m: RegExpExecArray, rule: { head: string; body: string }) => boolean): string[] {
  const out: string[] = [];
  for (const file of cssFiles(SRC)) {
    const css = readFileSync(file, 'utf8');
    for (let m = re.exec(css); m; m = re.exec(css)) {
      const rule = enclosingRule(css, m.index);
      if (!keep(m, rule)) continue;
      const line = css.slice(0, m.index).split('\n').length;
      out.push(`${file}:${line}`);
    }
  }
  return out.sort();
}

describe('the focus ring is authored, inward, and never silently deleted (#123)', () => {
  it('defines the ONE ring in globals.css, inward, on the --focus-ring token', () => {
    const css = readFileSync(GLOBALS, 'utf8');
    expect(css).toMatch(/--focus-ring:\s*[^;]+;/);
    const rule = /(^|\})\s*:focus-visible\s*\{([^}]*)\}/m.exec(css);
    expect(rule).not.toBeNull();
    const body = rule![2];
    expect(body).toMatch(/outline:[^;]*var\(--focus-ring\)/);
    expect(body).toMatch(/outline-offset:\s*-/); // inward, or containers clip it
  });

  it('lets no focus rule push its ring OUTSIDE the border box, where overflow clips it', () => {
    const outward = scan(/outline-offset\s*:\s*([^;]+);/g, (m, rule) => {
      if (!rule.head.includes(':focus')) return false; // semantic rings may sit outside
      const v = m[1].trim();
      return !v.startsWith('-') && !/^0\w*$/.test(v);
    });
    expect(outward).toEqual([]);
  });

  it('lets no rule suppress the ring without a stated reason', () => {
    const silent = scan(/outline\s*:\s*(none|0)\s*;/g, (_m, rule) =>
      !rule.body.includes(MARKER) && !rule.head.includes(MARKER),
    );
    expect(silent).toEqual([]);
  });
});
