'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import type { FeedItem } from '../lib/feed';
import styles from './Search.module.css';

// Header quick-search: a compact dropdown over the same /api/search endpoint and
// FeedItem shape used everywhere else. "See all results" opens the full /search page.

export default function Search() {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<FeedItem[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Focus on "/"
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement !== inputRef.current) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Debounced fetch with abort, so a slow earlier response can't overwrite a newer one.
  useEffect(() => {
    if (!query.trim()) {
      setItems([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
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
        placeholder="Search partners, programs, people… (Press '/')"
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
            <div className={styles.emptyState}>No results found for &quot;{query}&quot;</div>
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
                  See all results &rarr;
                </Link>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
