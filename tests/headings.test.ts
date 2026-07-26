/** @jest-environment node */
// A heading names a thing. It does not need a colon to announce that content
// follows it, or a dash to point at what is underneath — the layout already says
// that, and the punctuation is ink carrying no information (design.md §1).
// "Next Step:" sat above its own list for a long time before anyone said so, which
// is exactly why this is a test and not a note: the offenders arrive one at a time,
// in whichever locale someone was writing that day.
import fs from 'node:fs';
import path from 'node:path';
import { tsxFiles } from './helpers/sourceFiles';
import { cssFiles, blankComments } from './helpers/css';

const SRC = path.join(__dirname, '..', 'src');

/** Trailing colon / hyphen / en- / em-dash, with or without trailing space. */
const TRAILING = /[:\-–—]\s*$/;

/** Every localized string's EN value, keyed by its i18n key. */
function englishByKey(): Record<string, string> {
  const src = fs.readFileSync(path.join(SRC, 'lib', 'i18n.ts'), 'utf8');
  const out: Record<string, string> = {};
  for (const m of src.matchAll(/(\w+):\s*\{[^{}]*?en:\s*'((?:[^'\\]|\\[\s\S])*)'/g)) out[m[1]] = m[2];
  return out;
}

/** The contents of every <h1>…<h6> and <AnchorHeading> in the component tree. */
function headingContents(): { file: string; line: number; inner: string }[] {
  const found: { file: string; line: number; inner: string }[] = [];
  for (const file of tsxFiles(SRC)) {
    const txt = fs.readFileSync(file, 'utf8');
    // [\s\S] rather than `.` with the dotAll flag: headings span lines, and the
    // repo's TS target predates that flag.
    const re = /<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>|<AnchorHeading\b[^>]*>([\s\S]*?)<\/AnchorHeading>/g;
    for (const m of txt.matchAll(re)) {
      found.push({
        file: path.relative(path.join(SRC, '..'), file),
        line: txt.slice(0, m.index).split('\n').length,
        inner: m[2] ?? m[3] ?? '',
      });
    }
  }
  return found;
}

/** Every `*.module.css` rule whose selector targets an `<h1>`–`<h6>`, with its body. */
function headingRules(): { file: string; line: number; selector: string; body: string }[] {
  const found: { file: string; line: number; selector: string; body: string }[] = [];
  for (const file of cssFiles(SRC).filter((f) => f.endsWith('.module.css'))) {
    // Comments BLANKED, not stripped: this repo's stylesheets discuss declarations at
    // length (several paragraphs name `--p-600`), and a scan must not fire on a sentence
    // about a declaration — while every offset still points at the real source line.
    const css = blankComments(fs.readFileSync(file, 'utf8'));
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/(^|[\s>+~,.#[])h[1-6]\b/.test(m[1])) continue;
      found.push({
        file: path.relative(path.join(SRC, '..'), file),
        line: css.slice(0, m.index).split('\n').length,
        selector: m[1].trim(),
        body: m[2],
      });
    }
  }
  return found;
}

describe('headings', () => {
  it('finds headings to check (the scan itself has not silently broken)', () => {
    // A regex that matched nothing would make every assertion below vacuous.
    expect(headingContents().length).toBeGreaterThan(10);
  });

  it('no heading ends in a colon or a dash — in ANY locale', () => {
    const src = fs.readFileSync(path.join(SRC, 'lib', 'i18n.ts'), 'utf8');
    const en = englishByKey();
    const offenders: string[] = [];

    for (const { file, line, inner } of headingContents()) {
      // Literal text in the heading, with JSX expressions stripped out.
      const literal = inner.replace(/\{[^{}]*\}/g, '').trim();
      if (literal && TRAILING.test(literal)) offenders.push(`${file}:${line} literal “${literal}”`);

      // Localized text: check EVERY locale, not just English — the German and the
      // Japanese are just as visible to the people who read them.
      for (const key of new Set([...inner.matchAll(/'(\w+)'/g)].map((m) => m[1]))) {
        if (!(key in en)) continue;
        const block = src.match(new RegExp(`\\b${key}:\\s*\\{([^{}]*?)\\}`));
        if (!block) continue;
        for (const [, loc, value] of block[1].matchAll(/(en|de|ja|ko):\s*'((?:[^'\\]|\\[\s\S])*)'/g)) {
          if (TRAILING.test(value)) offenders.push(`${file}:${line} ${key}.${loc} “${value}”`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  // A heading's ink, not its words. `AnchorHeading` owns the markup but NOT the
  // typography — every page module declares its own `.section h2 { … }` — so a page can
  // re-tint a shared heading and nothing says otherwise. Two had: `/ecosystem`'s
  // `.sectionHeader h2` and `/partners/:id`'s `.sidebarCard h3` both painted themselves
  // `--p-600`, the BRAND GREEN that design.md §6 reserves for semantic positives (on
  // track, early, saved). A green heading reads as a status on a label that has none.
  //
  // Scoped to the green ramp on purpose: `--fg` (section headings) and `--muted` (the
  // uppercase micro-heading) are both legitimate and this must not adjudicate between
  // them. It catches the one thing that is never right.
  it('finds heading RULES to check (the CSS scan itself has not silently broken)', () => {
    // Same canary as the markup scan above: a brace matcher or an `h[1-6]` filter that
    // stopped matching would make the assertion below vacuous and permanently green.
    expect(headingRules().length).toBeGreaterThan(10);
  });

  it('no heading paints itself from the brand-green ramp', () => {
    const offenders = headingRules()
      .map((r) => ({ ...r, green: r.body.match(/(?:^|[\s;])color:\s*var\(\s*(--p-\d+)/) }))
      .filter((r) => r.green)
      .map((r) => `${r.file}:${r.line} ${r.selector} → ${r.green![1]}`);
    expect(offenders).toEqual([]);
  });
});
