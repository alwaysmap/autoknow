'use client';

import { useMemo, useState } from 'react';
import type { FeedItem } from '../lib/feed';
import { feedCategory, FEED_CATEGORY_LABEL, FEED_CATEGORY_ORDER, type FeedCategory } from '../lib/feedCategory';
import FeedList from './FeedList';
import styles from './ActivityFeed.module.css';

// The activity feed is a heterogeneous list of update types — needle changes, phase
// hill updates, ingested (Gemini) context, program creations. This wraps FeedList with
// category chips so, e.g., filtering to "Needle changes" yields a needle-change history
// and "Hill updates" a phase-progress history. Chips appear only for categories present.

export default function ActivityFeed({
  items,
  deletable = false,
  revalidate,
  emptyLabel = 'No activity yet.',
}: {
  items: FeedItem[];
  deletable?: boolean;
  revalidate?: string;
  emptyLabel?: string;
}) {
  const [active, setActive] = useState<'all' | FeedCategory>('all');

  const present = useMemo(() => {
    const seen = new Set(items.map((i) => feedCategory(i.kind)));
    return FEED_CATEGORY_ORDER.filter((c) => seen.has(c));
  }, [items]);

  const shown = active === 'all' ? items : items.filter((i) => feedCategory(i.kind) === active);

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
      {present.length > 1 && (
        <div className={styles.chips}>
          {chip('all', 'All')}
          {present.map((c) => chip(c, FEED_CATEGORY_LABEL[c]))}
        </div>
      )}
      <FeedList
        items={shown}
        emptyLabel={active === 'all' ? emptyLabel : 'No matching updates.'}
        deletable={deletable}
        revalidate={revalidate}
      />
    </div>
  );
}
