'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import type { FeedItem } from '../lib/feed';
import { t } from '../lib/i18n';
import { useLocale } from './LocaleProvider';
import styles from './Search.module.css';

// Header quick-search: a compact dropdown over the same /api/search endpoint and
// FeedItem shape used everywhere else. "See all results" opens the full /search page.

export default function Search() {
  const locale = useLocale();
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<FeedItem[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Focus on "/" — but never steal it from another text surface: typing a literal
  // "/" into a URL field, a dialog form, or the markdown editor must not jump the
  // caret to the header search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]'))) return;
      if (document.querySelector('dialog[open]')) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Debounced fetch with abort, so a slow earlier response can't overwrite a newer one.
  // Clearing on empty input goes through the same debounce, keeping all setItems calls
  // asynchronous (no synchronous setState inside the effect body).
  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      if (!query.trim()) {
        setItems([]);
        return;
      }
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal: ctrl.signal });
        if (res.ok) {
          const data = await res.json();
          setItems(data.items ?? []);
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') console.error('Search failed:', err);
      }
    }, 150);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query]);

  // Close on click-outside
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  return (
    <div ref={containerRef} className={styles.searchContainer}>
      <input
        ref={inputRef}
        type="search"
        aria-label={t(locale, 'searchGlobalAria')}
        placeholder={t(locale, 'searchGlobalPlaceholder')}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        className={styles.searchBar}
      />

      {isOpen && query.trim() && (
        <div className={styles.dropdown}>
          {items.length === 0 ? (
            <div className={styles.emptyState}>{t(locale, 'searchNoResults', { q: query })}</div>
          ) : (
            <div className={styles.resultsWrapper}>
              <ul className={styles.list}>
                {items.slice(0, 8).map((it) => {
                  const body = (
                    <>
                      <span className={styles.mainText}>{it.title}</span>
                      <span className={styles.subText}>
                        {it.kind}
                        {it.subtitle ? ` · ${it.subtitle}` : ''}
                      </span>
                    </>
                  );
                  return (
                    <li key={it.id} className={styles.item}>
                      {it.external ? (
                        <a href={it.href} target="_blank" rel="noopener noreferrer" className={styles.link}>{body}</a>
                      ) : (
                        <Link href={it.href} onClick={() => setIsOpen(false)} className={styles.link}>{body}</Link>
                      )}
                    </li>
                  );
                })}
              </ul>
              <div className={styles.allResultsWrapper}>
                <Link href={`/search?q=${encodeURIComponent(query)}`} onClick={() => setIsOpen(false)} className={styles.allResultsLink}>
                  {t(locale, 'searchSeeAll')}
                </Link>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
