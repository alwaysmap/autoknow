'use client';

import { useState, useMemo } from 'react';
import { t } from '../lib/i18n';
import { useLocale } from './LocaleProvider';
import AnchoredPopover from './AnchoredPopover';
import SearchField from './SearchField';
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

  // ---- Opt-in free-text filter on the KEY (first) column ----
  // A FILTER over already-loaded rows, not a search: it narrows `data` to rows whose
  // key-column value contains the text (case-insensitive substring), issues no request,
  // and joins the same active-filter set as the funnels — the bar's "× Clear filters"
  // clears it too (design.md §6). Controlled by the host so it round-trips to the URL.
  // Presence of `onTextFilterChange` turns the box on.
  /** Current text-filter value (controlled). */
  textFilter?: string;
  onTextFilterChange?: (value: string) => void;
  /** Placeholder — reads as a FILTER ("Filter programs…"), never "Search…". */
  textFilterPlaceholder?: string;

  // ---- Filter-bar extras (non-column controls hosted in the same bar) ----
  /** Extra controls rendered in the filter bar beside the text box — e.g. Partners'
   *  "My partners" toggle, which is a scope switch, not a column. */
  filterBarExtras?: React.ReactNode;
  /** True when a `filterBarExtras` control is active, so "× Clear filters" appears and
   *  resets it (via onClearExtras) even with no column/text filter set. */
  extrasActive?: boolean;
  onClearExtras?: () => void;
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
  textFilter,
  onTextFilterChange,
  textFilterPlaceholder,
  filterBarExtras,
  extrasActive = false,
  onClearExtras,
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
  // The per-column filter popovers are AnchoredPopover instances now (#24): it owns
  // placement (top-layer, so no overflow-x crop of the rightmost column — the bug the
  // old hand-rolled flip only half-fixed), light-dismiss, and — via `popover="auto"` —
  // one-open-at-a-time for free, so the single-open `openFilterKey` state is gone.

  const filterValueOf = (h: Header, row: T): string =>
    h.filterValue ? h.filterValue(row) : String(valueAt(row, h.key) ?? '');

  const optionsFor = (h: Header): string[] =>
    [...new Set(data.map((row) => filterValueOf(h, row)))].sort((a, b) => a.localeCompare(b));

  // The value the free-text filter matches against: the KEY (first) column's cell.
  const keyColumnText = (row: T): string => String(valueAt(row, headers[0]?.key) ?? '');

  const filteredData = useMemo(() => {
    const active = headers.filter((h) => h.filterable && (filters[h.key]?.length ?? 0) > 0);
    const q = (textFilter ?? '').trim().toLowerCase();
    if (active.length === 0 && !q) return data;
    return data.filter(
      (row) =>
        active.every((h) => filters[h.key].includes(filterValueOf(h, row))) &&
        (!q || keyColumnText(row).toLowerCase().includes(q)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, headers, filters, textFilter]);

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

  // ---- Filter bar (text box + one "× Clear filters" for the whole set) ----
  const showTextFilter = onTextFilterChange != null;
  const anyFunnelActive = headers.some((h) => h.filterable && (filters[h.key]?.length ?? 0) > 0);
  const textActive = (textFilter ?? '').trim().length > 0;
  const hasClearable = anyFunnelActive || textActive || extrasActive;
  // Render the bar when there's a box to show, host extras to host, or anything to
  // clear — otherwise a funnel-only table with no active filter shows no empty bar.
  const showBar = showTextFilter || filterBarExtras != null || hasClearable;
  // One reset for the whole set: the funnels, the text box, and any host extra.
  const clearAllFilters = () => {
    setFilters({});
    onTextFilterChange?.('');
    onClearExtras?.();
  };

  return (
    <>
      {showBar && (
        <div className={styles.filterRow}>
          {showTextFilter && (
            <SearchField
              value={textFilter ?? ''}
              // Reset to page 1 on every keystroke so a narrowed set never strands the
              // reader on a now-empty page (the funnels reset the page the same way).
              onChange={(v) => {
                setCurrentPage(1);
                onTextFilterChange?.(v);
              }}
              placeholder={textFilterPlaceholder ?? t(locale, 'filterListPlaceholder')}
            />
          )}
          {filterBarExtras}
          {hasClearable && (
            <button type="button" className={styles.clearAll} onClick={clearAllFilters}>
              ✕ {t(locale, 'clearAllFilters')}
            </button>
          )}
        </div>
      )}
      <div className={styles.tableWrapper}>
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
                          <AnchoredPopover
                            variant="panel"
                            panelLabel={t(locale, 'filterColumn', { c: h.label })}
                            panelClassName={styles.filterPop}
                            renderTrigger={(triggerProps) => (
                              <button
                                {...triggerProps}
                                type="button"
                                className={`${styles.filterBtn} ${(filters[h.key]?.length ?? 0) > 0 ? styles.filterActive : ''}`}
                                aria-label={t(locale, 'filterColumn', { c: h.label })}
                                data-testid={`filter-${h.key}`}
                                // popoverTarget (in triggerProps) toggles the panel; stop the
                                // click bubbling so it never reaches the header's sort control
                                onClick={(e) => e.stopPropagation()}
                              >
                                {/* the standard three-line funnel */}
                                <svg viewBox="0 0 12 12" width={11} height={11} aria-hidden>
                                  <line x1={1} y1={2.5} x2={11} y2={2.5} stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />
                                  <line x1={3} y1={6} x2={9} y2={6} stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />
                                  <line x1={5} y1={9.5} x2={7} y2={9.5} stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />
                                </svg>
                                {(filters[h.key]?.length ?? 0) > 0 && <span className={styles.filterCount}>{filters[h.key].length}</span>}
                              </button>
                            )}
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
                          </AnchoredPopover>
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
                <td colSpan={headers.length} className={styles.info} style={{ padding: '1rem', textAlign: 'center', fontStyle: 'italic' }}>
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
    </>
  );
}
