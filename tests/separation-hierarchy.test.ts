import { readFileSync } from 'fs';
import { globSync } from 'glob';
import { dirname, resolve } from 'path';

// design.md §7, "Separation hierarchy — one mechanism per boundary, never stacked":
//
//   3. A block that needs naming: the heading IS the separator. A headed block
//      gets no border-top of its own and the heading gets no underline — heading
//      + spacing does all the work. Either a rule or a heading, never both.
//
//   If two horizontal lines are ever visible with nothing between them, one of
//   these levels is being double-applied.
//
// §7 was prose only; the vertical-rhythm test checks units and whole pixels, not
// the separation hierarchy. This closes that gap (AGENTS lesson 2 — a rule lives
// in software, not in prose) so the class of defect measured on /partners/15 in
// issue #47 — a full-width hairline stacked above a section heading that already
// separates — cannot return. The same doubling was present on /people, /programs,
// the admin console, and the Manage → Sources ingestion card.
//
// A block is "headed" two ways, and both are caught:
//   (a) the CSS itself names the heading — `.section h2 { … }` styles a heading
//       DESCENDANT of the bordered block (partners, people, programs, admin); or
//   (b) the component names it — the bordered container class wraps a heading
//       element as its first child in the JSX (IngestionHealthCard: `.section`
//       around `<h3 className={styles.sectionTitle}>`).
//
// The page-title hairline is NOT caught and must not be: it is a `border-bottom`
// on `.header` (§7 rule 4, the one full-width rule that bounds the column), never
// a `border-top`, so a border-top scan never sees it.

const MODULES = globSync('src/**/*.module.css').sort();
const TSX = globSync('src/**/*.{tsx,ts}');

/** The tsx/ts files that import a given CSS module (its own components). */
function importersOf(moduleFile: string): string[] {
  const modAbs = resolve(moduleFile);
  return TSX.filter((f) => {
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(/from\s+['"]([^'"]+\.module\.css)['"]/g)) {
      if (resolve(dirname(f), m[1]) === modAbs) return true;
    }
    return false;
  });
}

/** class → true if a component applies it to a container whose FIRST child is a
 *  heading element (`<h1..6>` or `<AnchorHeading>`) — the JSX-authored heading. */
function classesWrappingAHeading(tsxFiles: string[]): Set<string> {
  const headed = new Set<string>();
  for (const f of tsxFiles) {
    const text = readFileSync(f, 'utf8');
    // Every `className={styles.NAME}` (bare or leading a template `${styles.NAME} …`).
    for (const m of text.matchAll(/className=\{`?\$?\{?\s*styles\.([A-Za-z][\w]*)\b/g)) {
      const cls = m[1];
      const after = text.slice(m.index);
      const gt = after.indexOf('>'); // end of this element's opening tag
      if (gt === -1) continue;
      // First JSX element that opens after this container does — skip JSX
      // comments and `{…}` expressions, which contain no element tag.
      const child = /<([A-Za-z][\w]*)/.exec(after.slice(gt + 1));
      if (child && /^(h[1-6]|AnchorHeading)$/.test(child[1])) headed.add(cls);
    }
  }
  return headed;
}

describe('separation hierarchy (design.md §7 rule 3)', () => {
  test('there are CSS modules to check', () => {
    expect(MODULES.length).toBeGreaterThan(10);
  });

  test('no headed block carries its own border-top (heading OR rule, never both)', () => {
    const offenders: string[] = [];

    for (const file of MODULES) {
      const raw = readFileSync(file, 'utf8');
      // Blank out comments but keep every newline, so `css` line numbers still
      // match the file (a reported offender must point at the real line).
      const css = raw.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));

      // A class is "headed" one of two ways, both computed once per module:
      //   (a) the CSS styles a heading descendant of it — `.section h2 { … }`;
      //   (b) a component wraps it around a heading element (its first child).
      const headedByCss = new Set<string>();
      for (const m of css.matchAll(/\.([A-Za-z][\w-]*)[\s>~+]+h[1-6]\s*\{/g)) {
        headedByCss.add(m[1]);
      }
      const headedByJsx = classesWrappingAHeading(importersOf(file));

      // Every rule that paints a top border (value `none` is a removal, not a rule).
      for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const [, selector, body] = m;
        const bt = /border-top\s*:\s*([^;]+)/.exec(body);
        if (!bt || /^\s*none\b/.test(bt[1])) continue;

        // The subject is the last class in the selector — the element painted.
        const classes = [...selector.matchAll(/\.([A-Za-z][\w-]*)/g)].map((c) => c[1]);
        const subject = classes[classes.length - 1];
        if (!subject) continue;

        if (headedByCss.has(subject) || headedByJsx.has(subject)) {
          const line = css.slice(0, m.index).split('\n').length;
          offenders.push(
            `${file}:${line}  .${subject} carries border-top AND is a headed block — the heading is the separator (§7 rule 3)`,
          );
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
