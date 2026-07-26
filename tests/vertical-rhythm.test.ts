import { readFileSync } from 'fs';
import { globSync } from 'glob';
import { stripComments } from './helpers/css';

// Enforce the vertical rhythm in software rather than in prose (AGENTS lesson 2).
// Every rule here was a real defect found by measuring the rendered page on
// 2026-07-20: `line-height: 1.6` gave 25.6px line boxes, half-pixel type sizes and
// paddings gave half-pixel boxes, and each one put the hairline below it on a
// fractional pixel, where a 1px border renders as a soft 2px smear.
//
// The invariant: anything that contributes to an element's HEIGHT must land on a
// whole pixel. Widths are exempt — horizontal fractions do not stack the way
// vertical ones do, and the audit found no near-miss horizontal edges.

const CSS = globSync('src/**/*.css').sort();
const PX_PER_REM = 16;

/** `0.8125rem` → 13, `13px` → 13. */
function toPx(value: string, unit: string): number {
  return parseFloat(value) * (unit === 'rem' ? PX_PER_REM : 1);
}

/** Each `{ … }` rule block, with the file and 1-based line it starts on. */
function blocks(): Array<{ file: string; line: number; body: string }> {
  const out: Array<{ file: string; line: number; body: string }> = [];
  for (const file of CSS) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/\{[^{}]*\}/g)) {
      out.push({ file, line: text.slice(0, m.index).split('\n').length, body: m[0] });
    }
  }
  return out;
}

const at = (b: { file: string; line: number }) => `${b.file}:${b.line}`;

describe('vertical rhythm', () => {
  test('there is CSS to check', () => {
    expect(CSS.length).toBeGreaterThan(20);
  });

  test('no length that affects height is a fraction of a pixel', () => {
    // letter-spacing and border-width are exempt: a 0.5px letter-space is a
    // typographic choice and a hairline is allowed to be thin.
    const offenders: string[] = [];
    for (const file of CSS) {
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (/letter-spacing|border|outline|shadow|stroke/.test(line)) return;
        const prop = /^\s*(padding|margin|gap|row-gap|height|min-height|max-height|top|bottom|inset)[^:]*:(.+);/.exec(line);
        if (!prop) return;
        for (const [, v] of prop[2].matchAll(/(-?[0-9]*\.[0-9]+)px/g)) {
          if (Math.abs(parseFloat(v) - Math.round(parseFloat(v))) > 0.001) {
            offenders.push(`${file}:${i + 1}  ${line.trim()}`);
          }
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  test('every font-size resolves to a whole pixel', () => {
    const offenders: string[] = [];
    for (const file of CSS) {
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        const m = /font-size:\s*([0-9.]+)(px|rem)/.exec(line);
        if (!m) return;
        const px = toPx(m[1], m[2]);
        if (Math.abs(px - Math.round(px)) > 0.001) {
          offenders.push(`${file}:${i + 1}  ${m[0]} = ${px}px`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  test('every font-size produces a whole-pixel line box', () => {
    // An ODD size under a ratio is the trap: 13px x 1.5 = 19.5px. Such a rule must
    // state an explicit integer line-height instead of inheriting a ratio.
    const offenders: string[] = [];
    for (const b of blocks()) {
      const fs = /font-size:\s*([0-9.]+)(px|rem)/.exec(b.body);
      if (!fs) continue;
      const px = toPx(fs[1], fs[2]);
      const lh = /line-height:\s*([0-9.]+)(px|rem)?/.exec(b.body);

      if (!lh) {
        // Inherits the body ratio (1.5); only even sizes survive that.
        if ((px * 1.5) % 1 !== 0) {
          offenders.push(`${at(b)}  font-size ${px}px inherits 1.5 → ${px * 1.5}px; state a line-height`);
        }
        continue;
      }
      const box = lh[2] ? toPx(lh[1], lh[2]) : parseFloat(lh[1]) * px;
      if (Math.abs(box - Math.round(box)) > 0.001) {
        offenders.push(`${at(b)}  ${fs[0]} + ${lh[0]} → ${box}px`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('lengths are rem, so the whole UI scales with the root', () => {
    // design.md §9. The sanctioned px exceptions are the ones that must stay ONE
    // device pixel however the page is scaled — hairlines, strokes, and the
    // graticule's tick — plus blur radii and media-query breakpoints (conditions,
    // not declarations, so the declaration-level scan below never sees them).
    // border-RADIUS is a length and must scale; only border/outline WIDTHS are the
    // sanctioned hairline exception. box-shadow is decorative (offsets, blur, and
    // 1px inset hairline dividers) and doesn't participate in layout rhythm — a
    // shadow that doesn't grow with the root is invisible, not broken.
    //
    // The graticule exemption names the two IMAGE tokens and stops there. Both carry a
    // 1px tick as ink; every other `--graticule-*` is GEOMETRY (height, min-width, lead,
    // and the scale's background-size pair) and is rem like any other length — matching
    // the family with a wildcard would exempt exactly the tokens that must keep scaling.
    const EXEMPT = /^(border(?!-radius)[a-z-]*|outline[a-z-]*|stroke[a-z-]*|box-shadow|background-size|backdrop-filter|text-decoration-thickness|--graticule(-scale)?)$/;
    const offenders: string[] = [];
    for (const file of CSS) {
      const text = stripComments(readFileSync(file, 'utf8'))
        .replace(/@media[^{]*/g, ''); // breakpoints are px by convention (§9)
      for (const m of text.matchAll(/([a-z-]+)\s*:((?:[^;{}]|\([^)]*\))*)/g)) {
        const [, prop, value] = m;
        if (EXEMPT.test(prop)) continue;
        // `999px` is the "fully round" sentinel: it clamps to half the box at any
        // scale, so it is a shape, not a measurement.
        if (prop === 'border-radius' && /^\s*999px\s*$/.test(value)) continue;
        if (/\d*\.?\d+px/.test(value)) {
          offenders.push(`${file}  ${prop}:${value.trim().slice(0, 40)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test('the body line box is a whole number of pixels', () => {
    const globals = readFileSync('src/app/globals.css', 'utf8');
    // Anchored: `:root[data-style="instrument"] body { … }` also ends in "body {"
    // and sets no type, so an unanchored match finds the wrong rule.
    const body = /^body\s*\{[^}]*\}/m.exec(globals)?.[0] ?? '';
    const size = /font-size:\s*([0-9.]+)(px|rem)/.exec(body);
    const ratio = /line-height:\s*([0-9.]+)(px|rem)?/.exec(body);
    expect(size).not.toBeNull();
    expect(ratio).not.toBeNull();
    const px = toPx(size![1], size![2]);
    const box = ratio![2] ? toPx(ratio![1], ratio![2]) : parseFloat(ratio![1]) * px;
    expect(box % 1).toBe(0);
  });
});
