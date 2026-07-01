'use client';

import { useMemo, useState } from 'react';
import type { FeedItem, FeedKind, FeedCategory } from '../lib/feed';
import FeedList from './FeedList';

// The activity feed is a heterogeneous list of update types — needle changes, phase
// hill updates, ingested (Gemini) context, program creations. This wraps FeedList with
// type filters so, e.g., filtering to "Needle changes" yields a needle-change history,
// and "Hill updates" a phase-progress history. Categories are derived from FeedKind so
// filtering stays in sync with rendering. (Mirror of lib/feed.feedCategory, inlined so
// this client component doesn't import the server-only feed module.)

const categoryOf = (kind: FeedKind): FeedCategory => {
  switch (kind) {
    case 'status':
    case 'relationship':
      return 'needle';
    case 'phase':
      return 'hill';
    case 'context':
      return 'context';
    case 'program-created':
      return 'created';
    default:
      return 'entity';
  }
};

const LABELS: Record<FeedCategory, string> = {
  needle: 'Needle changes',
  hill: 'Hill updates',
  context: 'Context',
  created: 'Created',
  entity: 'Other',
};
const ORDER: FeedCategory[] = ['needle', 'hill', 'context', 'created', 'entity'];

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
    const seen = new Set(items.map((i) => categoryOf(i.kind)));
    return ORDER.filter((c) => seen.has(c));
  }, [items]);

  const shown = active === 'all' ? items : items.filter((i) => categoryOf(i.kind) === active);

  const chip = (key: 'all' | FeedCategory, label: string) => {
    const on = active === key;
    return (
      <button
        key={key}
        type="button"
        onClick={() => setActive(key)}
        aria-pressed={on}
        style={{
          fontSize: 12,
          fontWeight: 600,
          padding: '5px 12px',
          borderRadius: 999,
          cursor: 'pointer',
          border: '1px solid var(--border)',
          background: on ? 'var(--fg)' : 'transparent',
          color: on ? 'var(--bg)' : 'var(--muted)',
        }}
      >
        {label}
      </button>
    );
  };

  return (
    <div>
      {present.length > 1 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          {chip('all', 'All')}
          {present.map((c) => chip(c, LABELS[c]))}
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
