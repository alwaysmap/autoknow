'use client';

import { useEffect, useRef } from 'react';
import type { TableSort } from './tableUrlState';

/** JSON with sorted keys — insertion-order-sensitive stringify would re-run the
 *  effect when an identical filter set arrives with different key order. */
function stableStringify(obj: Record<string, unknown>): string {
  return JSON.stringify(obj, Object.keys(obj).sort());
}

/** Mirror filters/sort (+ page-specific extras) into the URL, replace-style —
 *  no history spam, no scroll jump, first render untouched. */
export function useTableUrlSync(
  filters: Record<string, string[]>,
  sort: TableSort | null,
  extra?: Record<string, string | null>,
) {
  const first = useRef(true);
  // Every key this hook has ever written, so a cleared filter's param is removed
  // even when the caller drops the key from `filters` entirely.
  const managed = useRef(new Set<string>(['sort', 'dir']));
  useEffect(() => {
    if (first.current) {
      first.current = false;
      // Register deep-linked keys up front: if the user's FIRST interaction is
      // "clear filters", the cleared state has no keys, so without this the
      // initial params (?ownerName=…) would survive in the URL.
      for (const key of Object.keys(filters)) managed.current.add(key);
      return;
    }
    // Seed from the LIVE query string and touch only managed keys: rebuilding from
    // scratch erased unrelated params (notably the ?lang= locale deep-link) on the
    // first filter interaction.
    const qs = new URLSearchParams(window.location.search);
    for (const key of Object.keys(filters)) managed.current.add(key);
    for (const key of Object.keys(extra ?? {})) managed.current.add(key);
    for (const key of managed.current) qs.delete(key);

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
  }, [stableStringify(filters), sort?.key, sort?.dir, stableStringify(extra ?? {})]); // eslint-disable-line react-hooks/exhaustive-deps
}
