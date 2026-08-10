// THE table-filter predicate (autoknow-ws1): how a DataTable decides which rows its
// active funnels and its free-text box keep. Extracted from DataTable so a host that
// needs the FILTERED SET — not just the rendered table — can ask the same question
// instead of re-implementing it. /programs is the case that forced this: its timeline
// chart must plot exactly the rows the table below it is showing, and DataTable never
// hands the filtered set back (an onFilteredChange callback would be setState-in-effect,
// a lint error here). One predicate, two consumers; a host-side copy would drift the
// moment a filterValue mapper changed (AGENTS lesson 7).
//
// tests/tableFilter.test.ts pins the semantics AND scans that both consumers import
// from here rather than re-deriving the rules.

/** A column's filter contract — the part of DataTable's `Header` the predicate reads
 *  (`Header extends FilterColumn`, layering the presentational fields on top). ONE home
 *  for these fields' meaning, so the component and a host applying the predicate itself
 *  cannot document them apart. */
export interface FilterColumn {
  key: string;
  /** Discrete per-column filter (funnel in the header): options are the unique
   *  values in the data; multi-select is OR within the column, columns AND. */
  filterable?: boolean;
  /** Filter on this derived value instead of row[key] (e.g. canonical health). */
  filterValue?: (row: unknown) => string;
  /** Set-valued twin of `filterValue`, for a column whose cell holds several class
   *  tokens at once (a partner's Products, gh-286 part f). The funnel lists the UNION
   *  of every row's values, and a row passes when ANY selected value is among its own
   *  — membership, never combination, so "GAS" means "carries GAS", not "carries
   *  exactly GAS". Takes precedence over `filterValue` if both are set. */
  filterValues?: (row: unknown) => string[];
}

/** Resolves "partner.name"-style dotted keys against a row object. */
export const valueAt = (item: unknown, key: string): unknown =>
  key.split('.').reduce<unknown>((obj, part) => (obj as Record<string, unknown> | null | undefined)?.[part], item);

/** A row's filter tokens for a column — one for a scalar column, several for a
 *  set-valued one (`filterValues`). */
export const filterTokensOf = (col: FilterColumn, row: unknown): string[] =>
  col.filterValues
    ? col.filterValues(row)
    : [col.filterValue ? col.filterValue(row) : String(valueAt(row, col.key) ?? '')];

/**
 * The rows the active filters keep, in their incoming order.
 *
 * - Funnels: OR within a column, AND across columns; only `filterable` columns with a
 *   non-empty selection participate.
 * - Text: a case-insensitive substring FILTER on the KEY (first) column's value — a
 *   narrowing of already-loaded rows, never a search (design.md §6).
 * - With nothing active, returns `data` ITSELF, not a copy — DataTable memoizes on the
 *   result, and a fresh array for "no filtering happened" would defeat that.
 */
export function applyTableFilter<T>(
  data: readonly T[],
  columns: readonly FilterColumn[],
  filters: Record<string, string[]>,
  textFilter?: string,
): readonly T[] {
  const active = columns.filter((c) => c.filterable && (filters[c.key]?.length ?? 0) > 0);
  const q = (textFilter ?? '').trim().toLowerCase();
  if (active.length === 0 && !q) return data;
  const keyColumn = columns[0]?.key ?? '';
  return data.filter(
    (row) =>
      active.every((c) => filterTokensOf(c, row).some((v) => filters[c.key].includes(v))) &&
      (!q || String(valueAt(row, keyColumn) ?? '').toLowerCase().includes(q)),
  );
}
