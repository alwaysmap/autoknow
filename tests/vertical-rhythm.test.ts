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

/** The type-scale tokens (design.md §7b) as defined in globals.css: `--fs-detail`
 *  → `0.8125rem`. Parsed from the source, not restated here, so the test can never
 *  agree with a stale copy of the scale. Computed once and cached —
 *  `resolveTypeVars` runs per rule block, and re-reading globals.css hundreds of
 *  times per test run is pure waste. */
let TYPE_TOKENS: Record<string, string> | undefined;
function typeTokens(): Record<string, string> {
  if (TYPE_TOKENS) return TYPE_TOKENS;
  const globals = readFileSync('src/app/globals.css', 'utf8');
  const out: Record<string, string> = {};
  for (const m of globals.matchAll(/(--(?:fs|lh)-[a-z]+):\s*([0-9.]+rem)/g)) {
    out[m[1]] = m[2];
  }
  TYPE_TOKENS = out;
  return out;
}

/** Substitute `var(--fs-*)` / `var(--lh-*)` with their literal values, so the
 *  whole-pixel checks below keep biting on a rule written against the scale.
 *  Without this, converting `font-size: 0.8125rem` to `font-size: var(--fs-detail)`
 *  would silently move the rule out of the tests' sight. */
function resolveTypeVars(text: string): string {
  const tokens = typeTokens();
  return text.replace(/var\((--(?:fs|lh)-[a-z]+)\)/g, (whole, name: string) => tokens[name] ?? whole);
}

/** Each `{ … }` rule block, with the file and 1-based line it starts on. */
function blocks(): Array<{ file: string; line: number; body: string }> {
  const out: Array<{ file: string; line: number; body: string }> = [];
  for (const file of CSS) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/\{[^{}]*\}/g)) {
      out.push({ file, line: text.slice(0, m.index).split('\n').length, body: resolveTypeVars(m[0]) });
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
      resolveTypeVars(readFileSync(file, 'utf8')).split('\n').forEach((line, i) => {
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

  test('the type-scale tokens are whole-pixel sizes with whole-pixel boxes', () => {
    const tokens = typeTokens();
    // The scale exists (a rename or deletion should fail loudly, not silently
    // un-check every rule written against it) …
    for (const name of ['--fs-micro', '--fs-caption', '--fs-detail', '--fs-ui', '--fs-body', '--fs-section', '--fs-title', '--fs-stat', '--lh-heading']) {
      expect(tokens[name]).toBeDefined();
    }
    // … and every member lands on a whole pixel (§8d).
    for (const [name, value] of Object.entries(tokens)) {
      const px = parseFloat(value) * PX_PER_REM;
      expect({ name, px, whole: px % 1 === 0 }).toEqual({ name, px, whole: true });
    }
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

// ── §7b ratchets ─────────────────────────────────────────────────────────────
// Two RATCHETS in the componentRootMargins mold: each allowlist names the state
// of the codebase when the rule landed (2026-08-10) and may ONLY SHRINK — a new
// offender fails the first test, a fixed one left on the list fails the second.

/** Every literal font-size that is NOT a scale value, as `file :: <rem>` combos
 *  (per-file+value, not per-line, so unrelated edits don't churn the list). */
function offScaleSizes(): string[] {
  // SIZES only — the --lh-* boxes are not font-sizes, and letting them into the
  // set would bless 1.25rem/1.75rem type that the scale deliberately omits.
  const scale = new Set(
    Object.entries(typeTokens())
      .filter(([name]) => name.startsWith('--fs-'))
      .map(([, v]) => parseFloat(v)),
  );
  const found = new Set<string>();
  for (const file of CSS) {
    const text = stripComments(readFileSync(file, 'utf8'));
    for (const m of text.matchAll(/font-size:\s*([0-9.]+)rem/g)) {
      if (!scale.has(parseFloat(m[1]))) found.add(`${file} :: ${m[1]}rem`);
    }
  }
  return [...found].sort();
}

/** Every fractional opacity in a CSS module, as `file :: value` combos. `0` and
 *  `1` are state toggles (hover reveals, animation endpoints), not inks; the two
 *  sanctioned tokens (--disabled-opacity / --busy-opacity) are var() at their
 *  USAGE sites and never match the numeric pattern. Modules only — globals.css
 *  is exempt BECAUSE it holds those tokens' DEFINITIONS (`--disabled-opacity:
 *  0.5`), whose text the regex would match; the trade is that a fractional
 *  opacity added directly to globals.css escapes this ratchet. */
function fractionalOpacities(): string[] {
  const found = new Set<string>();
  for (const file of CSS.filter((f) => f.endsWith('.module.css'))) {
    const text = stripComments(readFileSync(file, 'utf8'));
    for (const m of text.matchAll(/opacity:\s*(0?\.[0-9]+)/g)) {
      found.add(`${file} :: ${m[1]}`);
    }
  }
  return [...found].sort();
}

// Off-scale literal sizes at the time the scale landed. Converting a file to the
// scale tokens removes its entries; adding a NEW off-scale size anywhere fails.
const OFF_SCALE_ALLOWLIST: readonly string[] = [
  'src/app/admin/page.module.css :: 1.25rem',
  'src/app/ecosystem-summary/EcosystemSummaryClient.module.css :: 0.625rem',
  'src/app/ecosystem-summary/EcosystemSummaryClient.module.css :: 2rem',
  'src/app/ecosystem/page.module.css :: 1.25rem',
  'src/app/escalations/[id]/page.module.css :: 0.9375rem',
  'src/app/not-found.module.css :: 0.9375rem',
  'src/app/not-found.module.css :: 1.75rem',
  'src/app/not-found.module.css :: 6rem',
  'src/app/programs/new/page.module.css :: 1.25rem',
  'src/app/templates/page.module.css :: 0.625rem',
  'src/components/AiBadge.module.css :: 0.625rem',
  'src/components/ChainLedger.module.css :: 0.9375rem',
  'src/components/ClassBox.module.css :: 0.625rem',
  'src/components/CycleTimeScatterPlot.module.css :: 0.625rem',
  'src/components/DataTable.module.css :: 0.5625rem',
  'src/components/IngestionHealthCard.module.css :: 1.25rem',
  'src/components/LatestTeasers.module.css :: 0.9375rem',
  'src/components/PartnerProgramRows.module.css :: 0.625rem',
  'src/components/PhaseGraph.module.css :: 0.625rem',
  'src/components/PhaseTrack.module.css :: 0.625rem',
  'src/components/PhaseTrack.module.css :: 0.9375rem',
  'src/components/SummaryPanel.module.css :: 0.625rem',
  'src/components/SummaryPanel.module.css :: 0.9375rem',
  'src/components/TemplateEditor.module.css :: 0.625rem',
  'src/components/TemplateEditor.module.css :: 1.25rem',
];

// Fractional opacities on file when --faint landed, AUDITED one by one (pass 3/6,
// autoknow-c43): every entry turned out to be a STATE or a MARK, not a resting
// text ink — the seven verbatim `:hover { opacity: 0.8 }` are filter-chip hover
// feedback, the 0.85s are solid-button hovers, and the rest dim geometry (chart
// dots, band fills, drag ghosts, an animation keyframe, SVG fill-opacity) or one
// whole retired ROW (EscalationRows .rowClosed — glyph and text fade as a unit,
// which per-child --faint could not do). They stay listed so a NEW opacity-as-ink
// cannot ride in beside them; the four hand-rolled `:disabled` dims that were
// here are gone onto var(--disabled-opacity), which never matches the pattern.
const OPACITY_ALLOWLIST: readonly string[] = [
  'src/app/ecosystem-summary/EcosystemSummaryClient.module.css :: 0.8',
  'src/app/escalations/page.module.css :: 0.8',
  'src/app/initiatives/[id]/page.module.css :: 0.8',
  'src/app/partners/[id]/page.module.css :: 0.8',
  'src/app/partners/page.module.css :: 0.8',
  'src/app/people/[id]/page.module.css :: 0.8',
  'src/app/programs/page.module.css :: 0.8',
  'src/app/templates/page.module.css :: 0.85',
  'src/components/ChainLedger.module.css :: 0.55',
  'src/components/CycleTimeScatterPlot.module.css :: 0.6',
  'src/components/EscalationRows.module.css :: 0.65',
  'src/components/IngestionHealthCard.module.css :: 0.5',
  'src/components/IngestionHealthCard.module.css :: 0.85',
  'src/components/InstrumentGauge.module.css :: 0.45',
  'src/components/InstrumentGauge.module.css :: 0.55',
  'src/components/PhaseTrack.module.css :: 0.06',
  'src/components/PhaseTrack.module.css :: 0.18',
  'src/components/PhaseTrack.module.css :: 0.8',
  'src/components/PhaseTrack.module.css :: 0.85',
  'src/components/PhaseTrack.module.css :: 0.92',
  'src/components/ProgramPhaseEditor.module.css :: 0.75',
  'src/components/SummaryPanel.module.css :: 0.35',
  'src/components/TemplateEditor.module.css :: 0.85',
];

describe('§7b type scale & ink ratchets', () => {
  it('every literal font-size is a scale value — a NEW off-scale size fails CI', () => {
    expect(offScaleSizes().filter((v) => !OFF_SCALE_ALLOWLIST.includes(v))).toEqual([]);
  });

  it('keeps the off-scale allowlist honest — a fixed entry must be removed', () => {
    const found = new Set(offScaleSizes());
    expect(OFF_SCALE_ALLOWLIST.filter((v) => !found.has(v))).toEqual([]);
  });

  it('no new fractional opacity in a module — de-emphasis is an ink (--faint), not a fade', () => {
    expect(fractionalOpacities().filter((v) => !OPACITY_ALLOWLIST.includes(v))).toEqual([]);
  });

  it('keeps the opacity allowlist honest — a fixed entry must be removed', () => {
    const found = new Set(fractionalOpacities());
    expect(OPACITY_ALLOWLIST.filter((v) => !found.has(v))).toEqual([]);
  });
});
