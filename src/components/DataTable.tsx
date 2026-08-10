'use client';

import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { t } from '../lib/i18n';
import { useLocale } from './LocaleProvider';
import AnchoredPopover from './AnchoredPopover';
import SearchField from './SearchField';
import {
  ROWS_PER_TABLE,
  readLocalPref,
  subscribePrefChange,
  writeLocalPref,
} from '../lib/preferences';
import { applyTableFilter, filterTokensOf, valueAt, type FilterColumn } from '../lib/tableFilter';
import styles from './DataTable.module.css';

/** A column: `FilterColumn` carries the filter contract (`filterable`, `filterValue`,
 *  `filterValues` — semantics documented there, where the predicate lives); everything
 *  presentational stacks on top here. */
export interface Header extends FilterColumn {
  label: string;
  sortable?: boolean;
  /** Comparison type for this column. Omitted → inferred (number/Date as-is, then
   *  case-insensitive string). Set 'date' explicitly for ISO-date strings — the old
   *  auto-sniff treated any Date.parse-able string with a '-' as a date, mis-sorting
   *  columns like IDs or ranges ("3-2") and varying by engine. */
  sortType?: 'date' | 'number' | 'string';
  /** Sort on this derived value instead of row[key] — `filterValue`'s twin, and needed
   *  for the same reason: a column whose key holds a non-scalar. Sorting stringifies
   *  what it finds, so an object under the key compares as '[object Object]' and the
   *  column silently stops sorting while its header stays clickable. A person column
   *  keyed on a `PersonRef` (#127 E7) is the case that forced this; before it existed,
   *  the workaround was to park a scalar under the key and render from a sibling field,
   *  which cost the column two names for one thing. */
  sortValue?: (row: unknown) => string | number;
  /** Display label for an option value (e.g. localized health). */
  filterLabel?: (value: string) => string;
  /**
   * A width hint for this column, in `rem` (design.md §9). Applied to the header cell,
   * which is what the browser's auto table layout sizes the column from.
   *
   * This is the answer to "can a cell span two columns" — it cannot, and should not: a
   * `colSpan` body cell would leave the row with fewer cells than the header has, and
   * every per-column funnel, the sort key, and the `<th scope="row">` association are all
   * positional. One column that is simply WIDER gets the same reading space without
   * desynchronising the grammar. Prefer it on the KEY column, whose content is a sentence
   * while its neighbours are tokens.
   */
  width?: string;
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
  /** Explicit FIXED page size. Omit to use the per-user `ROWS_PER_TABLE` preference (#31).
   *  SETTING it also hides the rows-per-page control, and that coupling is deliberate: a
   *  fixed size overrides the preference, so the control would be a select that cannot
   *  change anything.
   *
   *  No caller sets it today — see `paginate` for the not-paged case, which is what the
   *  short fixed tables actually needed (#125). Kept as a public knob for a genuinely
   *  paged listing that wants a size other than the user's preference. */
  pageSize?: number;
  /** `false` declares a table that is NEVER paged: every row renders and the footer is
   *  gone IN FULL — no "Showing {a}-{b} of {c} results", no Prev/Next, no rows-per-page
   *  control.
   *
   *  Declared, not derived (#125 decision B), and it HAS to be. A table is fixed-size
   *  because its data source caps it — a `LIMIT`, a `MAX_ROWS` top-N — and that cap lives
   *  at the call site, not in the rows. Five rows here might be a strip that will never
   *  exceed eight, or a listing that happens to hold five today and five hundred next
   *  month; the data looks identical either way, so only the caller who wrote the cap
   *  can tell them apart. */
  paginate?: boolean;
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

export default function DataTable<T>({
  headers,
  data,
  renderRow,
  defaultSortKey = '',
  defaultSortOrder = 'asc',
  onSortChange,
  pageSize,
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
  paginate = true,
}: DataTableProps<T>) {
  const locale = useLocale();
  const emptyMessage = emptyStateMessage ?? t(locale, 'noResultsFound');
  const [sortKey, setSortKey] = useState<string>(defaultSortKey);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>(defaultSortOrder);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // ---- Off-screen-column affordance (gh-268): a horizontally-scrolled table gives no
  // sign columns exist past either edge, and the frozen first column (below) makes the
  // usual clipped-mid-glyph cue absent at the left. A pure-CSS scroll-shadow was tried
  // first and reverted (see the GitHub issue) — it painted BEHIND the table's own opaque
  // cell backgrounds and was invisible in a screenshot. This reads real scroll state
  // instead (the NavLinks/ThemeToggle pattern: useSyncExternalStore, refs unattached
  // pre-mount → both `false`, matching a table that fits, so hydration never mismatches),
  // and renders the cue as its own stacked DOM element (see `.scrollCue` in the module
  // CSS) — a real element painting above the table settles the "which paints on top"
  // question the background-trick version left to chance. ----
  const scrollRef = useRef<HTMLDivElement>(null);

  const subscribeScroll = useCallback((onChange: () => void) => {
    const el = scrollRef.current;
    if (!el) return () => {};
    el.addEventListener('scroll', onChange, { passive: true });
    window.addEventListener('resize', onChange);
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      // Content width can change without a resize or a scroll (a column filter narrows
      // the option list's own width not at all, but sorting/paging can change row text
      // enough to grow/shrink columns) — observe the table's own box, not just the
      // window's.
      ro = new ResizeObserver(onChange);
      ro.observe(el);
    }
    return () => {
      el.removeEventListener('scroll', onChange);
      window.removeEventListener('resize', onChange);
      ro?.disconnect();
    };
  }, []);
  // Two separate hook calls, not one returning `{left, right}`: useSyncExternalStore
  // compares snapshots by reference, so a composite object would be a NEW reference on
  // every render regardless of whether either flag actually changed — an infinite
  // render loop, not just a wasted one. Two booleans avoids the trap entirely; the cost
  // is `subscribeScroll` running twice (two listeners, two observers on the same
  // element), which is cheap for a component with one scrollport.
  //
  // 1px of slack: a table that exactly fits can report a fractional scrollWidth vs.
  // clientWidth mismatch from subpixel layout, which would flash a permanent cue on a
  // table that never actually scrolls.
  const canScrollLeft = useSyncExternalStore(
    subscribeScroll,
    () => (scrollRef.current ? scrollRef.current.scrollLeft > 1 : false),
    () => false,
  );
  const canScrollRight = useSyncExternalStore(
    subscribeScroll,
    () => {
      const el = scrollRef.current;
      if (!el) return false;
      return el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    },
    () => false,
  );

  // ---- Page size: the per-user ROWS_PER_TABLE preference (#31), read hydration-safe as an
  // external store (ThemeToggle is the reference; setState-in-effect is a lint error).
  // `pageSize` overrides it — see the prop's own doc. ----
  const prefRows = useSyncExternalStore(
    subscribePrefChange,
    () => readLocalPref(ROWS_PER_TABLE),
    () => ROWS_PER_TABLE.default,
  );
  // Page size is a SETTING; the record count is a VARIABLE that arrives with the data. For
  // an unpaged table the two collapse — the page is however many records the capped source
  // returned — so read it off `data` rather than trying to anticipate the cap. `data` is
  // the PRE-filter array while the slice below runs over `sortedData`: safe, because
  // filtering and sorting never grow the set (and `filteredData` is not in scope yet).
  // The `1` keeps `totalPages` finite when there are no rows at all.
  const effectivePageSize = paginate ? (pageSize ?? prefRows) : Math.max(data.length, 1);
  const showPageSizeControl = paginate && pageSize === undefined;

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

  const optionsFor = (h: Header): string[] =>
    [...new Set(data.flatMap((row) => filterTokensOf(h, row)))].sort((a, b) => a.localeCompare(b));

  // The predicate itself lives in lib/tableFilter — the ONE home for what the funnels
  // and the text box mean, shared with hosts that need the filtered set (autoknow-ws1).
  const filteredData = useMemo(
    () => applyTableFilter(data, headers, filters, textFilter),
    [data, headers, filters, textFilter],
  );

  // 1. Sort the data client-side
  const sortHeader = headers.find((h) => h.key === sortKey);
  const sortType = sortHeader?.sortType;
  const sortValue = sortHeader?.sortValue;
  const sortedData = useMemo(() => {
    if (!sortKey) return filteredData;

    return [...filteredData].sort((a, b) => {
      let valA = sortValue ? sortValue(a) : valueAt(a, sortKey);
      let valB = sortValue ? sortValue(b) : valueAt(b, sortKey);

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
  }, [filteredData, sortKey, sortOrder, sortType, sortValue]);

  // 2. Paginate the sorted data
  const totalPages = Math.max(1, Math.ceil(sortedData.length / effectivePageSize));

  // Guard current page range for rendering. The Prev/Next handlers below base their
  // next value on activePage (not the stored currentPage), so when the data shrinks
  // past the stored page the controls still move correctly without needing an effect.
  const activePage = Math.min(currentPage, totalPages);

  const paginatedData = useMemo(() => {
    const startIndex = (activePage - 1) * effectivePageSize;
    return sortedData.slice(startIndex, startIndex + effectivePageSize);
  }, [sortedData, activePage, effectivePageSize]);

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

  const startIndex = (activePage - 1) * effectivePageSize + 1;
  const endIndex = Math.min(activePage * effectivePageSize, sortedData.length);

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
    // A real root, not a fragment (#158) — the root owns the strip→table gap, the host
    // owns the space above it; see `DataTable.module.css .wrapper`.
    <div className={styles.wrapper}>
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
      {/* `.scrollRegion` wraps the scrollport rather than being it: the two cue strips
          are its DIRECT children, siblings of `.tableWrapper` rather than descendants of
          it, so they sit outside the horizontal scroll and never move with it — no
          `position: sticky` bookkeeping, and no competing with the frozen column's own
          stacking for who paints on top (see the hook comment above). */}
      <div className={styles.scrollRegion}>
        <div className={styles.tableWrapper} ref={scrollRef}>
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
                      style={h.width ? { width: h.width } : undefined}
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

          {/* Pagination Footer — suppressed IN FULL by `paginate={false}`; a partial hide
              (count kept, buttons dropped) is the bug that prop exists to fix. */}
          {paginate && sortedData.length > 0 && (
            <div className={styles.pagination}>
              <div className={styles.footerLeft}>
                <div className={styles.info}>
                  {t(locale, 'showingResults', { a: startIndex, b: endIndex, c: sortedData.length })}
                </div>
                {showPageSizeControl && (
                  <label className={styles.pageSizeControl}>
                    <span>{t(locale, 'rowsPerPage')}</span>
                    <select
                      className={styles.pageSizeSelect}
                      value={effectivePageSize}
                      aria-label={t(locale, 'rowsPerPage')}
                      onChange={(e) => {
                        writeLocalPref(ROWS_PER_TABLE, Number(e.target.value));
                        setCurrentPage(1);
                      }}
                    >
                      {(ROWS_PER_TABLE.values ?? []).map((n) => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </select>
                  </label>
                )}
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
        {/* Decorative only (aria-hidden) — unlike this component's other affordances,
            which DO have a non-visual equivalent (`aria-sort` on a sorted header,
            `aria-label` on the filter trigger), this cue currently has none: a table's
            full column set is already in the DOM regardless of scroll position, so
            nothing is HIDDEN from assistive tech, only from a sighted reader scanning a
            clipped viewport. Fine as a sighted-only affordance for that reason, but if
            the horizontal scroll position ever became load-bearing for a screen-reader
            user (e.g. content that only renders once scrolled into view), this would
            need a real signal, not just a decorative one. */}
        <div className={`${styles.scrollCue} ${styles.scrollCueLeft}`} data-visible={canScrollLeft} aria-hidden="true" />
        <div className={`${styles.scrollCue} ${styles.scrollCueRight}`} data-visible={canScrollRight} aria-hidden="true" />
      </div>
    </div>
  );
}
