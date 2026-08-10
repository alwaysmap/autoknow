/** @jest-environment node */
// The shared table-filter predicate (autoknow-ws1). Two halves, one purpose:
//
// 1. Pin the SEMANTICS — OR within a column, AND across columns, set-valued membership,
//    the key-column text narrowing — because /programs' timeline plots this function's
//    output while DataTable renders it, so a behaviour change here silently moves a
//    chart as well as a table.
// 2. Scan that both consumers actually IMPORT it. The predicate was extracted precisely
//    because the host could not reach DataTable's copy; a re-derived host copy would
//    re-open the drift the extraction closed (AGENTS lesson 7), and nothing but this
//    scan would notice.

import { readFileSync } from 'node:fs';
import { applyTableFilter, filterTokensOf, type FilterColumn } from '../src/lib/tableFilter';
import { stripComments } from './helpers/sourceFiles';

interface Row {
  name: string;
  partner: { region: string | null };
  health: string;
  products: string[];
}

const rows: Row[] = [
  { name: 'Alpha', partner: { region: 'AMER' }, health: 'raw-low', products: ['GAS'] },
  { name: 'Beta', partner: { region: 'EMEA' }, health: 'On Track', products: ['GAS', 'GBI'] },
  { name: 'Gamma', partner: { region: null }, health: 'Concerned', products: [] },
  { name: 'Alphametric', partner: { region: 'AMER' }, health: 'Concerned', products: ['GBI'] },
];

// One derived column (canonicalizing like /programs' health funnel does), one dotted-key
// column with a null fallback, one set-valued column — the three shapes the real hosts use.
const columns: FilterColumn[] = [
  { key: 'name' },
  { key: 'partner.region', filterable: true, filterValue: (r) => (r as Row).partner.region ?? 'Other' },
  { key: 'health', filterable: true, filterValue: (r) => ((r as Row).health === 'raw-low' ? 'On Track' : (r as Row).health) },
  { key: 'products', filterable: true, filterValues: (r) => (r as Row).products },
];

const names = (result: readonly Row[]) => result.map((r) => r.name);

describe('applyTableFilter', () => {
  test('nothing active returns the SAME array, not a copy — memo identity', () => {
    expect(applyTableFilter(rows, columns, {})).toBe(rows);
    expect(applyTableFilter(rows, columns, { health: [] }, '   ')).toBe(rows);
  });

  test('one column is OR within it, through the derived filterValue', () => {
    // 'On Track' catches Beta AND the canonicalized raw-low Alpha — the funnel filters
    // on what it DISPLAYS, never the raw stored token.
    expect(names(applyTableFilter(rows, columns, { health: ['On Track'] }) as Row[]))
      .toEqual(['Alpha', 'Beta']);
    expect(names(applyTableFilter(rows, columns, { health: ['On Track', 'Concerned'] }) as Row[]))
      .toEqual(['Alpha', 'Beta', 'Gamma', 'Alphametric']);
  });

  test('columns AND together', () => {
    expect(names(applyTableFilter(rows, columns, { health: ['Concerned'], 'partner.region': ['AMER'] }) as Row[]))
      .toEqual(['Alphametric']);
  });

  test('a null dotted key filters under its fallback token', () => {
    expect(names(applyTableFilter(rows, columns, { 'partner.region': ['Other'] }) as Row[]))
      .toEqual(['Gamma']);
  });

  test('a set-valued column passes on MEMBERSHIP, and an empty set never matches', () => {
    // "carries GAS", not "carries exactly GAS" — and Gamma, with no products, is kept by
    // no selection at all.
    expect(names(applyTableFilter(rows, columns, { products: ['GAS'] }) as Row[]))
      .toEqual(['Alpha', 'Beta']);
  });

  test('a selection on a column NOT declared filterable is ignored', () => {
    expect(applyTableFilter(rows, columns, { name: ['Alpha'] })).toBe(rows);
  });

  test('text narrows on the KEY column, case-insensitive substring, composed with funnels', () => {
    expect(names(applyTableFilter(rows, columns, {}, 'alpha') as Row[]))
      .toEqual(['Alpha', 'Alphametric']);
    expect(names(applyTableFilter(rows, columns, { health: ['Concerned'] }, 'ALPHA') as Row[]))
      .toEqual(['Alphametric']);
  });
});

describe('filterTokensOf', () => {
  test('precedence: filterValues over filterValue over the raw key', () => {
    const row = rows[1];
    expect(filterTokensOf({ key: 'name' }, row)).toEqual(['Beta']);
    expect(filterTokensOf({ key: 'name', filterValue: () => 'derived' }, row)).toEqual(['derived']);
    expect(filterTokensOf({ key: 'name', filterValue: () => 'derived', filterValues: () => ['a', 'b'] }, row))
      .toEqual(['a', 'b']);
  });
});

describe('one predicate, two consumers', () => {
  const imports = (file: string) =>
    /from '[./]+lib\/tableFilter'/.test(stripComments(readFileSync(file, 'utf8')));

  test.each([
    'src/components/DataTable.tsx',
    'src/app/programs/ProgramsClient.tsx',
  ])('%s imports lib/tableFilter rather than re-deriving the rules', (file) => {
    expect(imports(file)).toBe(true);
  });

  test('DataTable keeps no local copy of the predicate loop', () => {
    // The extracted body's signature move: `active.every(...some(...includes(...)))`.
    // A re-inlined copy would bring that shape back.
    const src = stripComments(readFileSync('src/components/DataTable.tsx', 'utf8'));
    expect(src).not.toMatch(/active\.every/);
  });
});
