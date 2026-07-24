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

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['src/app', 'src/components'];

const sourceFiles = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (full.endsWith('.tsx')) out.push(full);
  }
  return out;
};

/**
 * Each `<DataTable …>` OPENING TAG in a file, as raw text.
 *
 * Brace-tracked rather than regexed: a lazy `<DataTable[\s\S]*?>` stops at the first `>`
 * in the props, which in practice is the arrow of a `filterValue: (row) => …` callback.
 * That truncates the tag before most of its props, so the scan silently sees almost
 * nothing and can never fail — the vacuous-guard trap this file's second test exists to
 * notice. Depth counts `{}` so a `>` inside an expression does not end the tag.
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
      for (const file of sourceFiles(root)) {
        for (const site of callSites(file)) {
          if (/paginate=\{false\}/.test(site) && /onTextFilterChange/.test(site)) {
            bad.push(file);
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('still finds call sites to check — a scan that matches nothing proves nothing', () => {
    const total = ROOTS.flatMap((r) => sourceFiles(r)).flatMap(callSites).length;
    expect(total).toBeGreaterThan(0);
  });
});
