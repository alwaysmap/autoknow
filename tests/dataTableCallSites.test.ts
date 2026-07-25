/** @jest-environment node */
// Source-scan guard on how `DataTable` is CALLED, in the style of headings.test.ts and
// componentRootMargins.test.ts. An enforced rule needs no memory (AGENTS lesson 2).
//
// Two rules:
//
// 1. A table declared unpaged (`paginate={false}`) must not also take a free-text filter.
//    `paginate={false}` says "this is a fixed short panel" — a top-N strip is always N
//    records — and a filter box over five rows is the same class of noise as a pager that
//    can never act (#125, and #86's rule that the box belongs to browsable listings).
//
// 2. No raw `<table>` outside DataTable itself. design.md §6 asks new tables to use the
//    shared component rather than re-implement it; every hand-rolled one re-derived the
//    grammar (ISO DateCell, `<th scope="row">`, sortable headers) and drifted. This guard
//    could only land AFTER the last of them was converted (#125 Track A steps 1-4) — a
//    guard merged red is a guard someone disables.

import { readFileSync } from 'node:fs';
import { tsxFiles } from './helpers/sourceFiles';

const ROOTS = ['src/app', 'src/components'];
/** The one component allowed to render a `<table>` — everything else goes through it. */
const CONTAINER = 'src/components/DataTable.tsx';

/** Source with comments stripped: a comment ABOUT `<table>` is not a `<table>`, and one
 *  explaining a conversion is exactly what a naive grep trips on. */
const code = (file: string): string =>
  readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

/**
 * Each `<DataTable …>` OPENING TAG in a file, as raw text.
 *
 * Brace-tracked rather than regexed: a lazy `<DataTable[\s\S]*?>` stops at the first `>`
 * in the props, which in practice is the arrow of a `filterValue: (row) => …` callback.
 * That truncates the tag before most of its props, so the scan silently sees almost
 * nothing and can never fail. NOTE the second test below does NOT catch that — a
 * truncated match is still a match, so a "did we find any?" count stays green; it guards
 * the other emptiness (roots gone, component renamed). The truncation lesson is in
 * docs/knowledge/source-scan-over-jsx-props-truncates-at-an-arrow.md.
 * Depth counts `{}` so a `>` inside an expression does not end the tag.
 */
const callSites = (file: string): string[] => {
  const src = readFileSync(file, 'utf8');
  const out: string[] = [];
  for (const m of src.matchAll(/<DataTable\b/g)) {
    let depth = 0;
    for (let i = m.index!; i < src.length; i++) {
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
};

describe('DataTable call sites (#125)', () => {
  it('never combines paginate={false} with a free-text filter', () => {
    const bad: string[] = [];
    for (const root of ROOTS) {
      for (const file of tsxFiles(root)) {
        for (const site of callSites(file)) {
          if (/paginate=\{false\}/.test(site) && /onTextFilterChange/.test(site)) {
            bad.push(file);
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('still finds call sites at all — catches the roots moving or the component being renamed', () => {
    const total = ROOTS.flatMap((r) => tsxFiles(r)).flatMap(callSites).length;
    expect(total).toBeGreaterThan(0);
  });

  it('renders no raw <table> outside DataTable', () => {
    const raw = ROOTS.flatMap((r) => tsxFiles(r))
      .filter((f) => f !== CONTAINER)
      .filter((f) => /<table[\s>]/.test(code(f)));
    expect(raw).toEqual([]);
  });

  it('still sees the one <table> that IS allowed — proves the scan can find one at all', () => {
    // Without this, deleting DataTable's own table (or breaking `code()`) would leave the
    // guard above passing vacuously, which is this file's documented failure mode.
    expect(/<table[\s>]/.test(code(CONTAINER))).toBe(true);
  });
});
