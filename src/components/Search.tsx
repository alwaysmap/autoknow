'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import styles from './Search.module.css';

interface Partner {
  id: number;
  name: string;
  type: string;
}

interface Project {
  id: number;
  name: string;
  partner: {
    name: string;
  };
}

interface Person {
  id: number;
  name: string;
  email: string;
  currentPartner: {
    name: string;
  };
}

interface SearchResults {
  partners: Partner[];
  projects: Project[];
  people: Person[];
}

export default function Search() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults>({ partners: [], projects: [], people: [] });
  const [isOpen, setIsOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Focus search input when pressing "/"
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement !== searchInputRef.current) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Fetch search results on query change
  useEffect(() => {
    if (!query.trim()) {
      return;
    }

    const delayDebounce = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        if (res.ok) {
          const data = await res.json();
          setResults(data);
        }
      } catch (err) {
        console.error('Search query failed:', err);
      }
    }, 150);

    return () => clearTimeout(delayDebounce);
  }, [query]);

  // Handle click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const totalResults = results.partners.length + results.projects.length + results.people.length;

  return (
    <div ref={containerRef} className={styles.searchContainer}>
      <input
        ref={searchInputRef}
        type="search"
        placeholder="Search partners, projects, people... (Press '/')"
        value={query}
        onChange={(e) => {
          const val = e.target.value;
          setQuery(val);
          if (!val.trim()) {
            setResults({ partners: [], projects: [], people: [] });
          }
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        className={styles.searchBar}
      />

      {isOpen && query.trim() && (
        <div className={styles.dropdown}>
          {totalResults === 0 ? (
            <div className={styles.emptyState}>No results found for &quot;{query}&quot;</div>
          ) : (
            <div className={styles.resultsWrapper}>
              {results.partners.length > 0 && (
                <div className={styles.section}>
                  <div className={styles.sectionHeading}>Partners</div>
                  <ul className={styles.list}>
                    {results.partners.map(p => (
                      <li key={p.id} className={styles.item}>
                        <Link href={`/partners/${p.id}`} onClick={() => setIsOpen(false)} className={styles.link}>
                          <span className={styles.mainText}>{p.name}</span>
                          <span className={styles.subText}>{p.type}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {results.projects.length > 0 && (
                <div className={styles.section}>
                  <div className={styles.sectionHeading}>Projects</div>
                  <ul className={styles.list}>
                    {results.projects.map(p => (
                      <li key={p.id} className={styles.item}>
                        <Link href={`/projects/${p.id}`} onClick={() => setIsOpen(false)} className={styles.link}>
                          <span className={styles.mainText}>{p.name}</span>
                          <span className={styles.subText}>{p.partner.name}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {results.people.length > 0 && (
                <div className={styles.section}>
                  <div className={styles.sectionHeading}>People</div>
                  <ul className={styles.list}>
                    {results.people.map(p => (
                      <li key={p.id} className={styles.item}>
                        <Link href={`/people/${p.id}`} onClick={() => setIsOpen(false)} className={styles.link}>
                          <span className={styles.mainText}>{p.name}</span>
                          <span className={styles.subText}>{p.email} ({p.currentPartner.name})</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {/* All results link */}
              <div className={styles.allResultsWrapper}>
                <Link href={`/search?q=${encodeURIComponent(query)}`} onClick={() => setIsOpen(false)} className={styles.allResultsLink}>
                  See all matching results &amp; semantic documents &rarr;
                </Link>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
