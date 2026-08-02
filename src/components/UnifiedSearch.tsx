'use client';

import { useState, useEffect, useRef, type ChangeEvent, type KeyboardEvent } from 'react';
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
  escalation: 'escalationsLabel',
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
  const [suggest, setSuggest] = useState<FeedItem[] | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const suggestAbort = useRef<AbortController | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // Keyboard navigation of the suggestion list (bug: arrow keys did nothing). -1 means
  // the typed text is "selected"; 0..n-1 highlight a suggestion. `itemRefs` lets Enter
  // fire the highlighted row's own link, so keyboard and mouse take the exact same path.
  const [activeIndex, setActiveIndex] = useState(-1);
  const itemRefs = useRef<(HTMLAnchorElement | null)[]>([]);

  // What the dial in the field reports: SOMETHING IS IN FLIGHT. Both requests
  // count — while you type it is the suggest, after you commit it is the full
  // search — because the dial reports the machine, not which endpoint is busy.
  const busy = loading || suggesting;

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
      // No caller passes a person scope today; serialized so the union has one spelling
      // on the wire rather than a variant this component drops in silence.
      if (scope?.kind === 'person') params.set('personId', String(scope.id));
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
        setSuggesting(false);
        return;
      }
      setSuggesting(true);
      try {
        const params = new URLSearchParams({ q: query, types: [...active].join(',') });
        const res = await fetch(`/api/search?${params.toString()}`, { signal: ctrl.signal });
        if (res.ok) setSuggest(((await res.json()).items ?? []).slice(0, SUGGEST_MAX));
      } catch (e) {
        if ((e as Error).name !== 'AbortError') console.error('Suggest failed:', e);
      } finally {
        // Same rule as `run` above: only the CURRENT request may park the dial.
        // An aborted predecessor's `finally` resolves AFTER its replacement set
        // the dial running, and would stop it mid-flight.
        if (suggestAbort.current === ctrl) setSuggesting(false);
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

  /** Clearing the box restores the empty landing page — no full refresh required. */
  const resetToLanding = () => {
    abortRef.current?.abort();
    suggestAbort.current?.abort();
    setSuggestOpen(false);
    setSuggest(null);
    setHits(null);
    setActiveIndex(-1);
    setActive(new Set(availableTypes));
  };

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);
    setActiveIndex(-1); // a fresh keystroke means a fresh list; nothing highlighted yet
    if (!hero) return;
    if (value.trim()) setSuggestOpen(true);
    else resetToLanding();
  };

  const move = (delta: number) => {
    const n = suggest?.length ?? 0;
    if (n === 0) return;
    const next = Math.min(n - 1, Math.max(-1, activeIndex + delta));
    setActiveIndex(next);
    if (next >= 0) itemRefs.current[next]?.scrollIntoView({ block: 'nearest' });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!hero) return;
    if (e.key === 'Escape') { setSuggestOpen(false); setActiveIndex(-1); return; }
    const count = suggest?.length ?? 0;
    const open = showSuggest && count > 0;
    if (e.key === 'ArrowDown') {
      if (!open) {
        if (count > 0 && query.trim()) { e.preventDefault(); setSuggestOpen(true); setActiveIndex(0); }
        return;
      }
      e.preventDefault();
      move(1);
    } else if (e.key === 'ArrowUp') {
      if (!open) return;
      e.preventDefault();
      move(-1);
    } else if (e.key === 'Enter' && open && activeIndex >= 0) {
      // Commit the HIGHLIGHTED suggestion. With nothing highlighted, Enter falls through
      // to the form's submit, which runs the full search ("see all results").
      e.preventDefault();
      itemRefs.current[activeIndex]?.click();
    }
  };

  return (
    <div className={hero ? styles.hero : undefined}>
      <div className={styles.box} ref={boxRef}>
        <form className={styles.form} onSubmit={(e) => { e.preventDefault(); submit(query); }}>
          {/* The wrapper is the dial's positioning context — an `<input>` cannot
              have children, so the only way to put something INSIDE the field is
              to overlay it on a box that shares the field's edges. (It previously
              anchored a `::after` focus sweep that has since been deleted; it was
              vestigial until the dial moved in here.) */}
          <span className={styles.inputWrap}>
            <input
              type="search"
              autoFocus={autoFocus}
              value={query}
              onChange={onChange}
              onFocus={() => { if (hero) setSuggestOpen(true); }}
              onKeyDown={onKeyDown}
              placeholder={inputPlaceholder}
              aria-label={inputPlaceholder}
              className={styles.input}
              // Autocomplete semantics on the searchbox so a screen reader announces
              // the highlighted row as you arrow through the list. Deliberately NOT
              // `role="combobox"`: that would drop the input's implicit `searchbox`
              // role (a11y regression the app tests for), and `aria-activedescendant`
              // over an owned listbox is a valid searchbox autocomplete on its own.
              aria-autocomplete={hero ? 'list' : undefined}
              aria-controls={hero && showSuggest ? 'search-suggest-list' : undefined}
              aria-activedescendant={
                hero && showSuggest && activeIndex >= 0 ? `search-suggest-opt-${activeIndex}` : undefined
              }
            />
            {/* The Instrument style's one graphic, INSIDE the field it reports on.
                Rendered in both styles and revealed by CSS, like every other
                style-conditional flourish. */}
            <span data-inst-only className={styles.gaugeSlot}>
              <InstrumentGauge busy={busy} />
            </span>
          </span>
          {/* The hero has no submit button: it answers while you type, so Enter
              and "see all results" are the only ways to commit, and a button
              beside a self-answering field is a second affordance for a job that
              already has one (2026-07-22, user call). Scoped searches DO wait for
              submit, so they keep theirs — and it is a plain label now, because
              the dial that used to ride on it lives in the field. */}
          {!hero && (
            <button type="submit" disabled={loading} className={styles.button}>
              {loading ? t(locale, 'searchingBtn') : t(locale, 'searchBtn')}
            </button>
          )}
          {/* The dial is aria-hidden, so without this a committed search is
              silent to a screen reader — which is exactly what the button's
              "Searching…" label used to say. Only the COMMITTED search speaks:
              announcing every debounced keystroke would make the field chatter. */}
          <span role="status" aria-live="polite" className={styles.srStatus}>
            {loading ? t(locale, 'searchingBtn') : ''}
          </span>
        </form>

        {showSuggest && (
          <div className={styles.dropdown} data-testid="search-suggest">
            {suggest.length === 0 ? (
              <p className={styles.suggestEmpty}>{t(locale, 'searchNoResults', { q: query })}</p>
            ) : (
              <>
                <ul id="search-suggest-list" role="listbox" className={styles.suggestList}>
                  {suggest.map((it, idx) => {
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
                    const active = idx === activeIndex;
                    const setRef = (el: HTMLAnchorElement | null) => { itemRefs.current[idx] = el; };
                    const itemClass = active ? `${styles.suggestItem} ${styles.suggestItemActive}` : styles.suggestItem;
                    return (
                      <li key={it.id} role="option" id={`search-suggest-opt-${idx}`} aria-selected={active}>
                        {it.external ? (
                          <a ref={setRef} href={it.href} target="_blank" rel="noopener noreferrer" aria-label={label} className={itemClass}>{body}</a>
                        ) : (
                          <Link ref={setRef} href={it.href} aria-label={label} onClick={() => setSuggestOpen(false)} className={itemClass}>{body}</Link>
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
