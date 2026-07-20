'use client';

import { useState, useEffect, useRef } from 'react';
import FeedList from './FeedList';
import type { FeedType, FeedScope, FeedItem } from '../lib/feed';
import { t, type StringKey } from '../lib/i18n';
import { useLocale } from './LocaleProvider';
import styles from './UnifiedSearch.module.css';

// One search component for every surface, backed by the standalone /api/search endpoint.
// `scope` keeps results inside the current partner/program (omit for ecosystem-wide).
// Type chips filter results in/out (partners, programs, people, context).

const TYPE_KEY: Record<FeedType, StringKey> = {
  partner: 'partnersLabel',
  program: 'navPrograms',
  person: 'peopleLabel',
  context: 'contextLabel',
};
const ALL: FeedType[] = ['partner', 'program', 'person', 'context'];

export default function UnifiedSearch({
  scope,
  availableTypes = ALL,
  placeholder,
  autoFocus = false,
  initialQuery = '',
  showTypeChips = true,
  hero = false,
}: {
  scope?: FeedScope;
  availableTypes?: FeedType[];
  placeholder?: string;
  autoFocus?: boolean;
  initialQuery?: string;
  /** Hide the type-filter chips (e.g. when a feed's own filter row sits right below). */
  showTypeChips?: boolean;
  /** Oversize the input — the landing page, where search is the page's purpose. */
  hero?: boolean;
}) {
  const locale = useLocale();
  const inputPlaceholder = placeholder ?? t(locale, 'searchPlaceholderShort');
  const [query, setQuery] = useState(initialQuery);
  const [active, setActive] = useState<Set<FeedType>>(new Set(availableTypes));
  const [hits, setHits] = useState<FeedItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const run = async (q: string, types = active) => {
    if (!q.trim() || types.size === 0) {
      setHits(types.size === 0 ? [] : null);
      return;
    }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    try {
      const params = new URLSearchParams({ q, types: [...types].join(',') });
      if (scope?.kind === 'partner') params.set('partnerId', String(scope.id));
      if (scope?.kind === 'project') params.set('projectId', String(scope.id));
      const res = await fetch(`/api/search?${params.toString()}`, { signal: ctrl.signal });
      if (res.ok) {
        const data = await res.json();
        setHits(data.items ?? []);
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') console.error('Search failed:', e);
    } finally {
      // Only the CURRENT request may clear the spinner: an aborted predecessor's
      // finally resolves after the replacement set loading=true and would re-enable
      // the button mid-flight.
      if (abortRef.current === ctrl) setLoading(false);
    }
  };

  // Abort any in-flight request on unmount — a late setHits after unmount is a leak.
  useEffect(() => () => abortRef.current?.abort(), []);

  // Run once on mount when a query is supplied via the URL (?q=).
  const ranInitial = useRef(false);
  useEffect(() => {
    if (initialQuery.trim() && !ranInitial.current) {
      ranInitial.current = true;
      run(initialQuery);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (t: FeedType) => {
    const next = new Set(active);
    if (next.has(t)) next.delete(t);
    else next.add(t);
    setActive(next);
    if (query.trim()) run(query, next);
  };

  return (
    <div className={hero ? styles.hero : undefined}>
      <form className={styles.form} onSubmit={(e) => { e.preventDefault(); run(query); }}>
        <input
          type="search"
          autoFocus={autoFocus}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={inputPlaceholder}
          aria-label={inputPlaceholder}
          className={styles.input}
        />
        <button type="submit" disabled={loading} className={styles.button}>
          {loading ? t(locale, 'searchingBtn') : t(locale, 'searchBtn')}
        </button>
      </form>

      {/* On the landing page the chips wait for results: four filled chips under an
          empty search box are the loudest thing on an otherwise quiet page, and
          they filter nothing until there's something to filter. */}
      {showTypeChips && availableTypes.length > 1 && (!hero || hits !== null) && (
        <div className={styles.chips}>
          {availableTypes.map((ft) => {
            const on = active.has(ft);
            return (
              <button
                key={ft}
                type="button"
                onClick={() => toggle(ft)}
                aria-pressed={on}
                className={styles.chip}
              >
                {t(locale, TYPE_KEY[ft])}
              </button>
            );
          })}
        </div>
      )}

      {hits !== null && (
        <div className={styles.results}>
          {!loading && (
            <div className={styles.count}>
              {scope && scope.kind !== 'ecosystem'
                ? hits.length === 1
                  ? t(locale, 'searchResultsScopeOne')
                  : t(locale, 'searchResultsScope', { n: hits.length })
                : hits.length === 1
                  ? t(locale, 'searchResultsEcosystemOne')
                  : t(locale, 'searchResultsEcosystem', { n: hits.length })}
            </div>
          )}
          <FeedList items={hits} emptyLabel={t(locale, 'searchNoMatches')} />
        </div>
      )}
    </div>
  );
}
