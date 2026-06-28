'use client';

import { useState, useMemo } from 'react';
import styles from './DataTable.module.css';

interface Header {
  key: string;
  label: string;
  sortable?: boolean;
}

interface DataTableProps {
  headers: Header[];
  data: any[];
  renderRow: (item: any) => React.ReactNode;
  defaultSortKey?: string;
  defaultSortOrder?: 'asc' | 'desc';
  pageSize?: number;
  emptyStateMessage?: string;
}

export default function DataTable({
  headers,
  data,
  renderRow,
  defaultSortKey = '',
  defaultSortOrder = 'asc',
  pageSize = 10,
  emptyStateMessage = 'No results found.',
}: DataTableProps) {
  const [sortKey, setSortKey] = useState<string>(defaultSortKey);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>(defaultSortOrder);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // 1. Sort the data client-side
  const sortedData = useMemo(() => {
    if (!sortKey) return data;

    return [...data].sort((a, b) => {
      let valA = a[sortKey];
      let valB = b[sortKey];

      // Handle nested properties if key contains a dot (e.g. "partner.name")
      if (sortKey.includes('.')) {
        const parts = sortKey.split('.');
        valA = parts.reduce((obj, key) => obj?.[key], a);
        valB = parts.reduce((obj, key) => obj?.[key], b);
      }

      // Treat null / undefined values
      if (valA === undefined || valA === null) valA = '';
      if (valB === undefined || valB === null) valB = '';

      // Date comparison
      if (valA instanceof Date && valB instanceof Date) {
        return sortOrder === 'asc'
          ? valA.getTime() - valB.getTime()
          : valB.getTime() - valA.getTime();
      }

      // Convert strings containing dates
      const isDateA = typeof valA === 'string' && !isNaN(Date.parse(valA)) && valA.includes('-');
      const isDateB = typeof valB === 'string' && !isNaN(Date.parse(valB)) && valB.includes('-');
      if (isDateA && isDateB) {
        return sortOrder === 'asc'
          ? Date.parse(valA) - Date.parse(valB)
          : Date.parse(valB) - Date.parse(valA);
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
  }, [data, sortKey, sortOrder]);

  // 2. Paginate the sorted data
  const totalPages = Math.max(1, Math.ceil(sortedData.length / pageSize));
  
  // Guard current page range
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
    } else {
      setSortKey(key);
      setSortOrder('asc');
    }
    setCurrentPage(1); // Reset page to 1 on sort change
  };

  const startIndex = (activePage - 1) * pageSize + 1;
  const endIndex = Math.min(activePage * pageSize, sortedData.length);

  return (
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
                  onClick={() => handleSort(h.key, h.sortable)}
                  className={`${styles.th} ${isSortable ? styles.sortable : ''} ${isSorted ? styles.sorted : ''}`}
                >
                  <div className={styles.headerCell}>
                    <span>{h.label}</span>
                    {isSorted && (
                      <span className={styles.sortIndicator}>
                        {sortOrder === 'asc' ? ' ▲' : ' ▼'}
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
                {emptyStateMessage}
              </td>
            </tr>
          ) : (
            paginatedData.map((item) => renderRow(item))
          )}
        </tbody>
      </table>

      {/* Pagination Footer */}
      {data.length > 0 && (
        <div className={styles.pagination}>
          <div className={styles.info}>
            Showing {startIndex}-{endIndex} of {data.length} results
          </div>
          <div className={styles.controls}>
            <button
              onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
              disabled={activePage === 1}
              className={styles.pageButton}
            >
              Prev
            </button>
            <span className={styles.pageIndicator}>
              Page {activePage} of {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
              disabled={activePage === totalPages}
              className={styles.pageButton}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
