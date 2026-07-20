'use client';

import { useState, useMemo, useEffect, useLayoutEffect, useRef } from 'react';
import { t } from '../lib/i18n';
import { useLocale } from './LocaleProvider';
import styles from './DataTable.module.css';

interface Header {
  key: string;
  label: string;
  sortable?: boolean;
  /** Comparison type for this column. Omitted → inferred (number/Date as-is, then
   *  case-insensitive string). Set 'date' explicitly for ISO-date strings — the old
   *  auto-sniff treated any Date.parse-able string with a '-' as a date, mis-sorting
   *  columns like IDs or ranges ("3-2") and varying by engine. */
  sortType?: 'date' | 'number' | 'string';
  /** Discrete per-column filter (funnel in the header): options are the unique
   *  values in the data; multi-select is OR within the column, columns AND. */
  filterable?: boolean;
  /** Filter on this derived value instead of row[key] (e.g. canonical health). */
  filterValue?: (row: unknown) => string;
  /** Display label for an option value (e.g. localized health). */
  filterLabel?: (value: string) => string;
}

interface DataTableProps<T> {
  headers: Header[];
  data: T[];
  renderRow: (item: T) => React.ReactNode;
  defaultSortKey?: string;
  defaultSortOrder?: 'asc' | 'desc';
  /** Fires on every user sort change — hosts encode it into the URL (design.md §6:
   *  table state is shareable). */
  onSortChange?: (key: string, order: 'asc' | 'desc') => void;
  pageSize?: number;
  emptyStateMessage?: string;
  /** Controlled column filters (key → selected values). Omit for uncontrolled. */
  filters?: Record<string, string[]>;
  onFiltersChange?: (next: Record<string, string[]>) => void;
  /** Uncontrolled initial selection (e.g. a deep-link preselecting Health). */
  initialFilters?: Record<string, string[]>;
}

// Sort accessor: resolves "partner.name"-style dotted keys against a row object.
const valueAt = (item: unknown, key: string): unknown =>
  key.split('.').reduce<unknown>((obj, part) => (obj as Record<string, unknown> | null | undefined)?.[part], item);

export default function DataTable<T>({
  headers,
  data,
  renderRow,
  defaultSortKey = '',
  defaultSortOrder = 'asc',
  onSortChange,
  pageSize = 10,
  emptyStateMessage,
  filters: controlledFilters,
  onFiltersChange,
  initialFilters,
}: DataTableProps<T>) {
  const locale = useLocale();
  const emptyMessage = emptyStateMessage ?? t(locale, 'noResultsFound');
  const [sortKey, setSortKey] = useState<string>(defaultSortKey);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>(defaultSortOrder);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // ---- Per-column filters (OR within a column, AND across columns) ----
  const [ownFilters, setOwnFilters] = useState<Record<string, string[]>>(initialFilters ?? {});
  const filters = controlledFilters ?? ownFilters;
  const setFilters = (next: Record<string, string[]>) => {
    if (onFiltersChange) onFiltersChange(next);
    if (!controlledFilters) setOwnFilters(next);
    setCurrentPage(1);
  };
  const [openFilterKey, setOpenFilterKey] = useState<string | null>(null);
  const filterPopRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  // Right-align the popup when a left-aligned one would poke past the wrapper's
  // right edge — the wrapper's overflow-x would crop it (rightmost columns).
  const [popFlipped, setPopFlipped] = useState(false);
  useLayoutEffect(() => {
    if (!openFilterKey) return;
    const pop = filterPopRef.current;
    const anchor = pop?.parentElement; // .filterWrap
    const wrap = wrapperRef.current;
    if (!pop || !anchor || !wrap) return;
    // Width is alignment-independent, so this measurement is idempotent even when
    // the popup is currently rendered flipped from a previous open.
    setPopFlipped(anchor.getBoundingClientRect().left + pop.offsetWidth > wrap.getBoundingClientRect().right);
  }, [openFilterKey]);
  useEffect(() => {
    if (!openFilterKey) return;
    const onDown = (e: PointerEvent) => {
      if (!filterPopRef.current?.contains(e.target as Node)) setOpenFilterKey(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenFilterKey(null); };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [openFilterKey]);

  const filterValueOf = (h: Header, row: T): string =>
    h.filterValue ? h.filterValue(row) : String(valueAt(row, h.key) ?? '');

  const optionsFor = (h: Header): string[] =>
    [...new Set(data.map((row) => filterValueOf(h, row)))].sort((a, b) => a.localeCompare(b));

  const filteredData = useMemo(() => {
    const active = headers.filter((h) => h.filterable && (filters[h.key]?.length ?? 0) > 0);
    if (active.length === 0) return data;
    return data.filter((row) => active.every((h) => filters[h.key].includes(filterValueOf(h, row))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, headers, filters]);

  // 1. Sort the data client-side
  const sortType = headers.find((h) => h.key === sortKey)?.sortType;
  const sortedData = useMemo(() => {
    if (!sortKey) return filteredData;

    return [...filteredData].sort((a, b) => {
      let valA = valueAt(a, sortKey);
      let valB = valueAt(b, sortKey);

      // Treat null / undefined values
      if (valA === undefined || valA === null) valA = '';
      if (valB === undefined || valB === null) valB = '';

      // Date comparison — actual Date objects, or a column declared sortType 'date'.
      if (valA instanceof Date && valB instanceof Date) {
        return sortOrder === 'asc'
          ? valA.getTime() - valB.getTime()
          : valB.getTime() - valA.getTime();
      }
      if (sortType === 'date') {
        const da = Date.parse(String(valA)), db = Date.parse(String(valB));
        const na = isNaN(da), nb = isNaN(db);
        if (na && nb) return 0;
        if (na) return 1; // unparseable dates sort last
        if (nb) return -1;
        return sortOrder === 'asc' ? da - db : db - da;
      }

      // Numeric comparison
      if (typeof valA === 'number' && typeof valB === 'number') {
        return sortOrder === 'asc' ? valA - valB : valB - valA;
      }

      // Case-insensitive string comparison
      const strA = String(valA).toLowerCase();
      const strB = String(valB).toLowerCase();

      if (strA < strB) return sortOrder === 'asc' ? -1 : 1;
      if (strA > strB) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filteredData, sortKey, sortOrder, sortType]);

  // 2. Paginate the sorted data
  const totalPages = Math.max(1, Math.ceil(sortedData.length / pageSize));

  // Guard current page range for rendering. The Prev/Next handlers below base their
  // next value on activePage (not the stored currentPage), so when the data shrinks
  // past the stored page the controls still move correctly without needing an effect.
  const activePage = Math.min(currentPage, totalPages);

  const paginatedData = useMemo(() => {
    const startIndex = (activePage - 1) * pageSize;
    return sortedData.slice(startIndex, startIndex + pageSize);
  }, [sortedData, activePage, pageSize]);

  // 3. Handle sort toggle
  const handleSort = (key: string, sortable?: boolean) => {
    if (sortable === false) return;

    if (sortKey === key) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
      onSortChange?.(key, sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortOrder('asc');
      onSortChange?.(key, 'asc');
    }
    setCurrentPage(1); // Reset page to 1 on sort change
  };

  const startIndex = (activePage - 1) * pageSize + 1;
  const endIndex = Math.min(activePage * pageSize, sortedData.length);

  return (
    <div className={styles.tableWrapper} ref={wrapperRef}>
      <table className={styles.table}>
        <thead>
          <tr>
            {headers.map((h) => {
              const isSorted = sortKey === h.key;
              const isSortable = h.sortable !== false;
              
              return (
                <th
                  key={h.key}
                  className={`${styles.th} ${isSortable ? styles.sortable : ''} ${isSorted ? styles.sorted : ''}`}
                  aria-sort={isSorted ? (sortOrder === 'asc' ? 'ascending' : 'descending') : undefined}
                >
                  <div className={styles.headerCell}>
                    {/* Sorting is a real control: a button so it's focusable and
                        announced, not a click-only span. */}
                    {isSortable ? (
                      <button type="button" className={styles.sortButton} onClick={() => handleSort(h.key, h.sortable)}>
                        {h.label}
                        {isSorted && <span className={styles.sortIndicator}>{sortOrder === 'asc' ? ' ▲' : ' ▼'}</span>}
                      </button>
                    ) : (
                      <span>{h.label}</span>
                    )}
                    {h.filterable && (
                      <span className={styles.filterWrap}>
                        <button
                          type="button"
                          className={`${styles.filterBtn} ${(filters[h.key]?.length ?? 0) > 0 ? styles.filterActive : ''}`}
                          aria-label={t(locale, 'filterColumn', { c: h.label })}
                          aria-expanded={openFilterKey === h.key}
                          data-testid={`filter-${h.key}`}
                          onClick={(e) => { e.stopPropagation(); setOpenFilterKey(openFilterKey === h.key ? null : h.key); }}
                        >
                          {/* the standard three-line funnel */}
                          <svg viewBox="0 0 12 12" width={11} height={11} aria-hidden>
                            <line x1={1} y1={2.5} x2={11} y2={2.5} stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />
                            <line x1={3} y1={6} x2={9} y2={6} stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />
                            <line x1={5} y1={9.5} x2={7} y2={9.5} stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />
                          </svg>
                          {(filters[h.key]?.length ?? 0) > 0 && <span className={styles.filterCount}>{filters[h.key].length}</span>}
                        </button>
                        {openFilterKey === h.key && (
                          <div
                            className={`${styles.filterPop} ${popFlipped ? styles.filterPopRight : ''}`}
                            ref={filterPopRef}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {optionsFor(h).map((v) => {
                              const checked = filters[h.key]?.includes(v) ?? false;
                              return (
                                <label key={v || '(empty)'} className={styles.filterOption}>
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => {
                                      const cur = filters[h.key] ?? [];
                                      setFilters({ ...filters, [h.key]: checked ? cur.filter((x) => x !== v) : [...cur, v] });
                                    }}
                                  />
                                  <span>{v ? (h.filterLabel ? h.filterLabel(v) : v) : '—'}</span>
                                </label>
                              );
                            })}
                            {(filters[h.key]?.length ?? 0) > 0 && (
                              <button
                                type="button"
                                className={styles.filterClear}
                                onClick={() => setFilters({ ...filters, [h.key]: [] })}
                              >
                                {t(locale, 'clearFilter')}
                              </button>
                            )}
                          </div>
                        )}
                      </span>
                    )}
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {paginatedData.length === 0 ? (
            <tr>
              <td colSpan={headers.length} className={styles.info} style={{ padding: '16px', textAlign: 'center', fontStyle: 'italic' }}>
                {emptyMessage}
              </td>
            </tr>
          ) : (
            paginatedData.map((item) => renderRow(item))
          )}
        </tbody>
      </table>

      {/* Pagination Footer */}
      {sortedData.length > 0 && (
        <div className={styles.pagination}>
          <div className={styles.info}>
            {t(locale, 'showingResults', { a: startIndex, b: endIndex, c: sortedData.length })}
          </div>
          <div className={styles.controls}>
            <button
              onClick={() => setCurrentPage(Math.max(1, activePage - 1))}
              disabled={activePage === 1}
              className={styles.pageButton}
            >
              {t(locale, 'prev')}
            </button>
            <span className={styles.pageIndicator}>
              {t(locale, 'pageOf', { a: activePage, b: totalPages })}
            </span>
            <button
              onClick={() => setCurrentPage(Math.min(totalPages, activePage + 1))}
              disabled={activePage === totalPages}
              className={styles.pageButton}
            >
              {t(locale, 'next')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
