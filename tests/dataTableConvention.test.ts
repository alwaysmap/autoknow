/** @jest-environment node */
// Source-scan guards on the shared-table convention — that `DataTable` is USED, and used
// correctly — in the style of headings.test.ts and componentRootMargins.test.ts. An
// enforced rule needs no memory (AGENTS lesson 2).
//
// Three rules:
//
// 1. A table declared unpaged (`paginate={false}`) must not also take a free-text filter.
//    `paginate={false}` says "this is a fixed short panel" — a top-N strip is always N
//    records — and a filter box over five rows is the same class of noise as a pager that
//    can never act (#125, and #86's rule that the box belongs to browsable listings).
//
// 2. No raw `<table>` outside DataTable itself. design.md §6 asks new tables to use the
//    shared component rather than re-implement it; every hand-rolled one re-derived the
//    grammar (ISO DateCell, `<th scope="row">`, sortable headers) and drifted.
//
// 3. No hand-rolled `<select>` filter in a DataTable host. Discrete filtering is the
//    in-header funnel; a bespoke select beside the table is a second grammar whose state
//    escapes the URL, which is what #87 fixed on /manage/sources and #95 on
//    /ecosystem-summary. Carried in from #87, where it could not land: the last
//    offender was #95's own subject, so the guard would have merged red.
//
// 4. No DATE rendered outside `DateCell` (#153). A date cell carries three things at
//    once — ISO in `dateTime`, the locale-short reading text, the ISO-week title — and a
//    host that formats its own gets at most one of them. Two tells, because a hand-rolled
//    date shows up as either: the `<time>` element, or a date-formatting call.
//
// 5. No PERSON route built outside `lib/entityHref` (#153). `PersonCell` is where a
//    person becomes a name + a route + the plain-text fallback; a host writing
//    `/people/${id}` by hand is a person rendered some other way. This is the sweep
//    entityHref's own comment asked for ("other call sites still hand-roll these
//    literals"). Its LIMIT, stated rather than implied: it catches a host that links a
//    person, not one that prints a person string with no link at all — source cannot tell
//    a person-shaped string from any other. The four columns that did exactly that
//    (#153's subject) are covered by review + the screenshots, not by this scan.

import { readFileSync } from 'node:fs';
import { tsxFiles, stripComments } from './helpers/sourceFiles';

const ROOTS = ['src/app', 'src/components'];
const DATA_TABLE = 'src/components/DataTable.tsx';
const DATE_CELL = 'src/components/DateCell.tsx';
const ENTITY_HREF = 'src/lib/entityHref.ts';

/** A `<time>` element, or a call that turns a date into display text. */
const DATE_RENDER = /<time[\s>]|toLocaleDateString|\blocalDate\(|\bisoDate\(|\bisoDateTime\(|\bisoWeekLabel\(/;

/** A person's route, written out rather than taken from `personHref`. */
const PERSON_ROUTE = /['"`]\/people\//;

const code = (file: string): string => stripComments(readFileSync(file, 'utf8'));

/**
 * Each `<DataTable …>` OPENING TAG in a file, as raw text.
 *
 * Brace-tracked rather than regexed: a lazy `<DataTable[\s\S]*?>` stops at the first `>`
 * in the props, which in practice is the arrow of a `filterValue: (row) => …` callback.
 * That truncates the tag before most of its props, so the scan silently sees almost
 * nothing and can never fail. NOTE the "still finds call sites at all" test does NOT catch
 * that — a truncated match is still a match, so a "did we find any?" count stays green;
 * it guards the other emptiness (roots gone, component renamed). The truncation lesson is in
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

describe('the shared-table convention (#125)', () => {
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

  it('finds no raw <table> outside DataTable', () => {
    const raw = ROOTS.flatMap((r) => tsxFiles(r))
      .filter((f) => f !== DATA_TABLE)
      .filter((f) => /<table[\s>]/.test(code(f)));
    expect(raw).toEqual([]);
  });

  it("still sees DataTable's own <table> — proves the scan can find one at all", () => {
    // Without this, deleting DataTable's own table (or breaking `code()`) would leave the
    // guard above passing vacuously, which is this file's documented failure mode.
    expect(/<table[\s>]/.test(code(DATA_TABLE))).toBe(true);
  });

  it('finds no hand-rolled <select> in a DataTable host', () => {
    const bad = ROOTS.flatMap((r) => tsxFiles(r))
      .filter((f) => callSites(f).length > 0)
      .filter((f) => /<select[\s>]/.test(code(f)));
    expect(bad).toEqual([]);
  });

  it('finds no date formatted in a DataTable host (#153)', () => {
    const bad = ROOTS.flatMap((r) => tsxFiles(r))
      .filter((f) => callSites(f).length > 0)
      .filter((f) => DATE_RENDER.test(code(f)));
    expect(bad).toEqual([]);
  });

  it("still sees DateCell's own date render — proves the scan can find one at all", () => {
    // The partner test the rule above is worthless without: DateCell is the ONE
    // legitimate date render in the app, so a pattern that cannot find it there would
    // pass every host vacuously. Both tells must fire — the <time> element AND the
    // formatting call — or half the rule is asleep.
    const src = code(DATE_CELL);
    expect(DATE_RENDER.test(src)).toBe(true);
    expect(/<time[\s>]/.test(src)).toBe(true);
    expect(/\blocalDate\(/.test(src)).toBe(true);
  });

  it('finds no hand-built person route in a DataTable host (#153)', () => {
    const bad = ROOTS.flatMap((r) => tsxFiles(r))
      .filter((f) => callSites(f).length > 0)
      .filter((f) => PERSON_ROUTE.test(code(f)));
    expect(bad).toEqual([]);
  });

  it("still sees entityHref's own person route — proves the scan can find one at all", () => {
    // Same reason as the DateCell partner: `personHref` is the one place the literal is
    // allowed to exist, so if the pattern misses it there, it misses everywhere.
    expect(PERSON_ROUTE.test(code(ENTITY_HREF))).toBe(true);
  });
});
