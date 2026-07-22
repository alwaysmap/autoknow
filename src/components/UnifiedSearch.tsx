'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import FeedList from './FeedList';
import type { FeedType, FeedKind, FeedScope, FeedItem } from '../lib/feed';
import { t, type StringKey } from '../lib/i18n';
import { useLocale } from './LocaleProvider';
import InstrumentGauge from './InstrumentGauge';
import KindBox from './KindBox';
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

/** Suggestions name the kind, which is wider than the filterable FeedType set. */
const KIND_LABEL: Record<FeedKind, StringKey> = {
  partner: 'partnerLabel',
  program: 'programLabel',
  person: 'personLabel',
  context: 'contextLabel',
  status: 'statusLabel',
  phase: 'phaseLabel',
  relationship: 'partnerLabel',
  'program-created': 'feedCatCreated',
};

/** Enough to recognise the thing you meant; the full list is one click away. */
const SUGGEST_MAX = 8;

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

  // ---- Autosuggest (hero only) ----
  // The landing page answers while you type; every other surface waits for submit.
  // Its own request and abort controller, so a slow suggest can never clobber the
  // full result set the user actually asked for.
  // Drives the Instrument dial on the CTA. Hover is the trigger the user asked
  // for; focus-visible is included so keyboard users get the same affordance.
  const [ctaLive, setCtaLive] = useState(false);
  const [suggest, setSuggest] = useState<FeedItem[] | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const suggestAbort = useRef<AbortController | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

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

  // Debounced suggest, aborting the predecessor so a slow earlier response can't
  // overwrite a newer one. Clearing on empty input goes through the same debounce,
  // keeping every setSuggest asynchronous (no setState in the effect body).
  useEffect(() => {
    if (!hero) return;
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      if (!query.trim()) {
        setSuggest(null);
        return;
      }
      try {
        const params = new URLSearchParams({ q: query, types: [...active].join(',') });
        const res = await fetch(`/api/search?${params.toString()}`, { signal: ctrl.signal });
        if (res.ok) setSuggest(((await res.json()).items ?? []).slice(0, SUGGEST_MAX));
      } catch (e) {
        if ((e as Error).name !== 'AbortError') console.error('Suggest failed:', e);
      }
    }, 150);
    suggestAbort.current = ctrl;
    return () => { clearTimeout(timer); ctrl.abort(); };
    // `active` is read, not tracked: re-suggesting on every chip toggle would fight
    // the full results the chips are actually filtering.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, hero]);

  // Click-outside closes the suggestions without disturbing the results below.
  useEffect(() => {
    if (!hero) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setSuggestOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [hero]);

  /** Commit the typed query: full results below, suggestions dismissed. */
  const submit = (q: string) => {
    setSuggestOpen(false);
    suggestAbort.current?.abort();
    run(q);
  };

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

  const showSuggest = hero && suggestOpen && query.trim().length > 0 && suggest !== null;

  return (
    <div className={hero ? styles.hero : undefined}>
      <div className={styles.box} ref={boxRef}>
        <form className={styles.form} onSubmit={(e) => { e.preventDefault(); submit(query); }}>
          {/* The wrapper exists purely to anchor the Instrument style's focus sweep
              (a ::after on this element); it is layout-neutral in both styles. */}
          <span className={styles.inputWrap}>
            <input
              type="search"
              autoFocus={autoFocus}
              value={query}
              onChange={(e) => { setQuery(e.target.value); if (hero) setSuggestOpen(true); }}
              onFocus={() => { if (hero) setSuggestOpen(true); }}
              onKeyDown={(e) => { if (e.key === 'Escape') setSuggestOpen(false); }}
              placeholder={inputPlaceholder}
              aria-label={inputPlaceholder}
              className={styles.input}
            />
          </span>
          <button
            type="submit"
            disabled={loading}
            className={styles.button}
            onMouseEnter={() => setCtaLive(true)}
            onMouseLeave={() => setCtaLive(false)}
            onFocus={() => setCtaLive(true)}
            onBlur={() => setCtaLive(false)}
          >
            {/* The Instrument style's one graphic. Rendered in both styles and
                revealed by CSS, like every other style-conditional flourish. */}
            <span data-inst-only className={styles.gaugeSlot}>
              <InstrumentGauge active={ctaLive || showSuggest} />
            </span>
            {loading ? t(locale, 'searchingBtn') : t(locale, 'searchBtn')}
          </button>
        </form>

        {showSuggest && (
          <div className={styles.dropdown} data-testid="search-suggest">
            {suggest.length === 0 ? (
              <p className={styles.suggestEmpty}>{t(locale, 'searchNoResults', { q: query })}</p>
            ) : (
              <>
                <ul className={styles.suggestList}>
                  {suggest.map((it) => {
                    const meta = `${t(locale, KIND_LABEL[it.kind])}${it.subtitle ? ` · ${it.subtitle}` : ''}`;
                    const body = (
                      <>
                        <KindBox kind={it.kind} locale={locale} />
                        <span className={styles.suggestTitle}>{it.title}</span>
                        {it.subtitle && <span className={styles.suggestMeta}>{it.subtitle}</span>}
                      </>
                    );
                    // The gap between title and meta is flex spacing, which is NOT a
                    // text node — without an explicit label the accessible name runs
                    // them together ("BoschPartner · Supplier"). Stated once here and
                    // reused for both link flavours so the two can't drift.
                    const label = `${it.title} — ${meta}`;
                    return (
                      <li key={it.id}>
                        {it.external ? (
                          <a href={it.href} target="_blank" rel="noopener noreferrer" aria-label={label} className={styles.suggestItem}>{body}</a>
                        ) : (
                          <Link href={it.href} aria-label={label} onClick={() => setSuggestOpen(false)} className={styles.suggestItem}>{body}</Link>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {/* The escape hatch to the full experience below — same component,
                    same results, just not truncated to the top few. */}
                <button type="button" className={styles.suggestAll} onClick={() => submit(query)}>
                  {t(locale, 'searchSeeAll')}
                </button>
              </>
            )}
          </div>
        )}
      </div>

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
