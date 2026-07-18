// Shareable table state (design.md §6): every filter and sort choice on the list
// pages lives in the URL. Encoding: one repeated query param per filterable column
// (?type=OEM&type=Supplier — OR within a column), plus ?sort=<column>&dir=asc|desc.
// Server pages parse the same params back into initialFilters/initialSort, so a
// copied URL reproduces the exact view.

export interface TableSort {
  key: string;
  dir: 'asc' | 'desc';
}

/** Parse repeated per-column params (server-side friendly: plain object input). */
export function parseFilterParams(
  searchParams: Record<string, string | string[] | undefined>,
  columns: string[],
): Record<string, string[]> {
  const filters: Record<string, string[]> = {};
  for (const col of columns) {
    const v = searchParams[col];
    if (v == null) continue;
    const arr = (Array.isArray(v) ? v : [v]).filter(Boolean);
    if (arr.length) filters[col] = arr;
  }
  return filters;
}

export function parseSortParams(
  searchParams: Record<string, string | string[] | undefined>,
): TableSort | null {
  const key = typeof searchParams.sort === 'string' ? searchParams.sort : null;
  if (!key) return null;
  const dir = searchParams.dir === 'desc' ? 'desc' : 'asc';
  return { key, dir };
}

