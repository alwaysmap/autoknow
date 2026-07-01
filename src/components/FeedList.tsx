import Link from 'next/link';
import type { FeedItem, FeedKind } from '../lib/feed';
import Markdown from './Markdown';
import { NeedleGaugeSvg } from './NeedleGauge';
import { deleteFeedItem } from '../app/actions/status';
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
  // Search results are already ordered by relevance — never surface the numeric score.
  if (typeof it.score === 'number') return '';
  if (it.timestamp) {
    return new Date(it.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
  return '';
}

export default function FeedList({
  items,
  emptyLabel = 'Nothing here yet.',
  deletable = false,
  revalidate,
}: {
  items: FeedItem[];
  emptyLabel?: string;
  deletable?: boolean; // show a remove control per entry (activity surfaces only)
  revalidate?: string; // path to revalidate after a delete
}) {
  if (items.length === 0) return <p className={styles.empty}>{emptyLabel}</p>;

  return (
    <div className={styles.list}>
      {items.map((it) => (
        <article key={it.id} className={styles.item}>
          {it.needle ? (
            <div className={styles.gauge}>
              <NeedleGaugeSvg
                progress={it.needle.progress}
                health={it.needle.health}
                previousProgress={it.needle.previousProgress}
                previousHealth={it.needle.previousHealth}
              />
            </div>
          ) : (
            <div className={styles.kind} style={{ color: KIND_COLOR[it.kind] }}>{KIND_LABEL[it.kind]}</div>
          )}
          <div className={styles.body}>
            <div className={styles.head}>
              {it.external ? (
                <a className={styles.title} href={it.href} target="_blank" rel="noopener noreferrer">{it.title}</a>
              ) : (
                <Link className={styles.title} href={it.href}>{it.title}</Link>
              )}
              <span className={styles.aside}>{aside(it)}</span>
              {deletable && (
                <form action={deleteFeedItem} style={{ display: 'inline-flex' }}>
                  <input type="hidden" name="id" value={it.id} />
                  {revalidate && <input type="hidden" name="revalidate" value={revalidate} />}
                  <button type="submit" title="Remove this update" aria-label="Remove"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted, #aaa)', fontSize: 13, lineHeight: 1, padding: '0 2px' }}>
                    ✕
                  </button>
                </form>
              )}
            </div>
            {it.subtitle && <div className={styles.meta}>{it.subtitle}</div>}
            {it.detail && <div className={styles.detail}><Markdown>{it.detail}</Markdown></div>}
          </div>
        </article>
      ))}
    </div>
  );
}
