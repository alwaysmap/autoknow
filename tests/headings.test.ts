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
});
