import Link from 'next/link';
import type { FeedItem, FeedKind } from '../lib/feed';
import styles from './FeedList.module.css';

// One presentational list for both search results and the activity feed. Renders a
// relevance "% match" when the item carries a score, otherwise a date when it carries
// a timestamp. Works in both server components (activity pages) and client components
// (UnifiedSearch) — it's purely presentational.

const KIND_LABEL: Record<FeedKind, string> = {
  partner: 'Partner',
  program: 'Program',
  person: 'Person',
  context: 'Context',
  status: 'Status',
  phase: 'Phase',
  relationship: 'Partner',
  'program-created': 'Created',
};
const KIND_COLOR: Record<FeedKind, string> = {
  partner: '#1a6b3c',
  program: '#1a4d8f',
  person: '#7a4ea0',
  context: '#b06000',
  status: '#1a4d8f',
  phase: '#1a6b3c',
  relationship: '#7a4ea0',
  'program-created': '#0a7d33',
};

function aside(it: FeedItem): string {
  if (typeof it.score === 'number') return `${Math.round(it.score * 100)}% match`;
  if (it.timestamp) {
    return new Date(it.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
  return '';
}

export default function FeedList({
  items,
  emptyLabel = 'Nothing here yet.',
}: {
  items: FeedItem[];
  emptyLabel?: string;
}) {
  if (items.length === 0) return <p className={styles.empty}>{emptyLabel}</p>;

  return (
    <div className={styles.list}>
      {items.map((it) => (
        <article key={it.id} className={styles.item}>
          <div className={styles.kind} style={{ color: KIND_COLOR[it.kind] }}>{KIND_LABEL[it.kind]}</div>
          <div className={styles.body}>
            <div className={styles.head}>
              {it.external ? (
                <a className={styles.title} href={it.href} target="_blank" rel="noopener noreferrer">{it.title}</a>
              ) : (
                <Link className={styles.title} href={it.href}>{it.title}</Link>
              )}
              <span className={styles.aside}>{aside(it)}</span>
            </div>
            {it.subtitle && <div className={styles.meta}>{it.subtitle}</div>}
            {it.detail && <p className={styles.detail}>{it.detail}</p>}
          </div>
        </article>
      ))}
    </div>
  );
}
