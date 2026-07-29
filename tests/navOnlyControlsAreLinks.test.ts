/** @jest-environment node */
// #168's ratchet (AGENTS lesson 2): a control whose entire job is changing WHERE you
// are — a route, a hash, a scroll position — is a link (design.md §6), never a
// `<button>`. The eight sites #168 found (five wrong-element buttons, three already-
// `<Link>` controls just wearing button paint) are fixed elsewhere in this change;
// this is what stops a NEW one from drifting back in.
//
// The scan looks for a `<button` whose own JSX tag text calls one of the four
// navigation-only primitives DIRECTLY (`location.hash =`, `history.pushState`,
// `history.replaceState`, `router.push`, `scrollIntoView`). It cannot see through a
// named function (`onClick={() => jumpTo(id)}`) to whatever that function does — that
// is a real, stated limit, not an oversight: `jumpTo` in PhaseTrack.tsx also sets
// `flashId` and toggles `collapsed`, real view-state changes that make it correctly a
// button, and a scan that tried to look inside every referenced function would have to
// resolve that call graph to tell the two cases apart. What it DOES catch is the likely
// regression — someone adding a new INLINE `onClick={() => { window.location.hash =
// … }}` — which is the shape every one of #168's five real violations had before they
// were fixed to use named handlers or `<Link>`.
//
// Brace-tracked tag extraction, not a lazy `<button[\s\S]*?>` — that stops at the first
// `>`, which in real JSX is usually an arrow function's `=>` inside the very `onClick`
// this scan needs to read
// (docs/knowledge/source-scan-over-jsx-props-truncates-at-an-arrow.md).
import { readFileSync } from 'node:fs';
import { tsxFiles, stripComments } from './helpers/sourceFiles';

const ROOTS = ['src/app', 'src/components'];
const NAV_ONLY = /location\.hash\s*=|history\.pushState|history\.replaceState|router\.push|scrollIntoView/;
// A rare legitimate exception (an inline handler that navigates AND does something
// else) states itself rather than being silently swallowed by the scan.
const EXEMPT = /data-nav-ok/;

/** Every `<button …>` opening tag in `src`, as raw text. */
export function buttonTags(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/<button\b/g)) {
    let depth = 0;
    for (let i = m.index!; i < src.length; i += 1) {
      const c = src[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) {
        out.push(src.slice(m.index!, i + 1));
        break;
      }
    }
  }
  return out;
}

/** The tags that navigate-only and are not marked as a stated exception. */
export const navOnlyButtons = (src: string): string[] =>
  buttonTags(src).filter((tag) => NAV_ONLY.test(tag) && !EXEMPT.test(tag));

describe('a nav-only control is a link, never a button (#168)', () => {
  it('finds none in the app today', () => {
    const offenders: { file: string; tag: string }[] = [];
    for (const root of ROOTS) {
      for (const file of tsxFiles(root)) {
        for (const tag of navOnlyButtons(stripComments(readFileSync(file, 'utf8')))) {
          offenders.push({ file, tag });
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  // Anti-vacuity (docs/knowledge/source-scan-over-jsx-props-truncates-at-an-arrow.md):
  // proves the scanner actually reads a real tag's full extent, by planting the
  // violation as the LAST prop — the position a lazy `[\s\S]*?>` regex would already
  // have stopped short of, since an earlier prop's own arrow-function `>` would have
  // closed the (wrong) match first.
  it('catches a planted violation in the LAST prop of a real-shaped tag', () => {
    const fixture = `
      <button
        type="button"
        onMouseEnter={(e) => { void e; }}
        aria-label={label}
        onClick={() => { window.location.hash = '#status-history'; }}
      >
        {t(locale, 'detail')}
      </button>
    `;
    expect(navOnlyButtons(fixture)).toHaveLength(1);
  });

  it('does not flag a button whose navigation is behind a named handler', () => {
    // The stated limit above: `openDetails` internally calls `writeHash` ->
    // `history.replaceState`, but that text never appears in the tag itself, and
    // `openDetails` legitimately does more than navigate elsewhere in this app.
    const fixture = `<button type="button" onClick={() => openDetails(p)}>{t(locale, 'details')}</button>`;
    expect(navOnlyButtons(fixture)).toEqual([]);
  });

  it('honors a stated exemption', () => {
    const fixture = `<button type="button" data-nav-ok onClick={() => { router.push('/x'); doSomethingElse(); }}>Go</button>`;
    expect(navOnlyButtons(fixture)).toEqual([]);
  });
});
