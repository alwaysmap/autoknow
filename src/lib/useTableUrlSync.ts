'use client';

import { useEffect, useRef } from 'react';
import type { TableSort } from './tableUrlState';

/** Mirror filters/sort (+ page-specific extras) into the URL, replace-style —
 *  no history spam, no scroll jump, first render untouched. */
export function useTableUrlSync(
  filters: Record<string, string[]>,
  sort: TableSort | null,
  extra?: Record<string, string | null>,
) {
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const qs = new URLSearchParams();
    for (const [col, values] of Object.entries(filters)) {
      for (const v of values ?? []) qs.append(col, v);
    }
    if (sort?.key) {
      qs.set('sort', sort.key);
      if (sort.dir === 'desc') qs.set('dir', 'desc');
    }
    for (const [k, v] of Object.entries(extra ?? {})) {
      if (v != null && v !== '') qs.set(k, v);
    }
    const query = qs.toString();
    // history.replaceState over router.replace: no server round-trip for a purely
    // client-side view change; the server still parses the params on a fresh load.
    window.history.replaceState(null, '', query ? `?${query}` : window.location.pathname);
  }, [JSON.stringify(filters), sort?.key, sort?.dir, JSON.stringify(extra ?? {})]); // eslint-disable-line react-hooks/exhaustive-deps
}
