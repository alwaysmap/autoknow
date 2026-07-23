'use client';

import { useMemo, useState } from 'react';
import type { FeedItem } from '../lib/feed';
import { feedCategory, FEED_CATEGORY_KEY, FEED_CATEGORY_ORDER, type FeedCategory } from '../lib/feedCategory';
import { t } from '../lib/i18n';
import { useLocale } from './LocaleProvider';
import FeedList from './FeedList';
import SearchField from './SearchField';
import styles from './ActivityFeed.module.css';

// The activity feed is a heterogeneous list of update types — needle changes, phase
// hill updates, ingested (Gemini) context, program creations. This wraps FeedList with
// category chips so, e.g., filtering to "Needle changes" yields a needle-change history
// and "Hill updates" a phase-progress history. Chips appear only for categories present.
//
// The search box narrows THIS activity (title/subtitle/detail), not the app's entities:
// it is a SearchField live-filter over items already on the page (design.md §8c), and it
// composes with the chips (text AND category). The scoped `UnifiedSearch` that used to
// sit above the feed searched partners/programs/people/context — never activity — and
// pushed the real history down the page (#41).

export default function ActivityFeed({
  items,
  deletable = false,
  revalidate,
  emptyLabel,
}: {
  items: FeedItem[];
  deletable?: boolean;
  revalidate?: string;
  emptyLabel?: string;
}) {
  const locale = useLocale();
  const [active, setActive] = useState<'all' | FeedCategory>('all');
  const [query, setQuery] = useState('');
  const defaultEmpty = emptyLabel ?? t(locale, 'noActivityYet');

  const present = useMemo(() => {
    const seen = new Set(items.map((i) => feedCategory(i.kind)));
    return FEED_CATEGORY_ORDER.filter((c) => seen.has(c));
  }, [items]);

  const q = query.trim().toLowerCase();
  const shown = items.filter((i) => {
    if (active !== 'all' && feedCategory(i.kind) !== active) return false;
    if (q && !`${i.title} ${i.subtitle ?? ''} ${i.detail ?? ''}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const filtering = active !== 'all' || q !== '';

  const chip = (key: 'all' | FeedCategory, label: string) => (
    <button
      key={key}
      type="button"
      onClick={() => setActive(key)}
      aria-pressed={active === key}
      className={`${styles.chip} ${active === key ? styles.chipActive : ''}`}
    >
      {label}
    </button>
  );

  return (
    <div>
      {items.length > 0 && (
        <div className={styles.search}>
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder={t(locale, 'searchActivity')}
            ariaLabel={t(locale, 'searchActivity')}
          />
        </div>
      )}
      {present.length > 1 && (
        <div className={styles.chips}>
          {chip('all', t(locale, 'allLabel'))}
          {present.map((c) => chip(c, t(locale, FEED_CATEGORY_KEY[c])))}
        </div>
      )}
      <FeedList
        items={shown}
        emptyLabel={filtering ? t(locale, 'noMatchingUpdates') : defaultEmpty}
        deletable={deletable}
        revalidate={revalidate}
      />
    </div>
  );
}
