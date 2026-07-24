/** @jest-environment node */
// Source-scan guard on how `DataTable` is CALLED, in the style of headings.test.ts and
// componentRootMargins.test.ts. An enforced rule needs no memory (AGENTS lesson 2).
//
// The rule: a table declared unpaged (`paginate={false}`) must not also take a free-text
// filter. `paginate={false}` says "this is a fixed short panel" — a top-N strip is always
// N records — and a filter box over five rows is the same class of noise as a pager that
// can never act (#125, and #86's rule that the box belongs to browsable listings).
// Nothing violates this today; the guard exists so the next conversion cannot introduce it.
//
// NOT here yet: the companion guard failing a raw `<table>` outside DataTable.tsx. It
// cannot land until BusiestResources is converted (#125 Track A step 3) — a guard merged
// red is a guard someone disables — so it ships with that change, by the issue's own
// sequencing.

import { readFileSync } from 'node:fs';
import { tsxFiles } from './helpers/sourceFiles';

const ROOTS = ['src/app', 'src/components'];

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
});
