import Link from 'next/link';
import type { FeedItem } from '../lib/feed';
import { t, type Locale, type StringKey } from '../lib/i18n';
import type { FeedKind } from '../lib/feed';
import { dayLabel, type DateLabelMode } from '../lib/dates';
import styles from './LatestTeasers.module.css';

// The landing page's "latest updates" strip: the newest handful of feed items in
// TEASER form — what it is, what it says in one clamped line, when. Deliberately
// NOT FeedList: that renders gauges, hill charts, markdown, and delete controls,
// which is the full record. This is the invitation to go read it.
//
// A server component: no interactivity, so the landing ships no JS for it. That is also
// why `dateLabels` arrives as a PROP rather than from `useDateLabels()` — there is no
// client context on a server component, so the reader's date-label mode reaches it the
// same way their locale does: resolved once by the page and handed down.

const KIND_KEY: Record<FeedKind, StringKey> = {
  partner: 'partnerLabel',
  program: 'programLabel',
  person: 'personLabel',
  context: 'contextLabel',
  initiative: 'initiativeLabel',
  status: 'statusLabel',
  phase: 'phaseLabel',
  relationship: 'partnerLabel',
  'program-created': 'feedCatCreated',
  escalation: 'escalationsLabel',
};

/** Markdown and long digests arrive as prose; the teaser wants one plain line. */
const TEASER_MAX = 180;
function teaser(detail: string | null | undefined): string | null {
  if (!detail) return null;
  const flat = detail
    .replace(/```[\s\S]*?```/g, ' ') // fenced code says nothing at a glance
    .replace(/[#*_>`[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!flat) return null;
  return flat.length > TEASER_MAX ? `${flat.slice(0, TEASER_MAX).trimEnd()}…` : flat;
}

export default function LatestTeasers(
  { items, locale, dateLabels }: { items: FeedItem[]; locale: Locale; dateLabels: DateLabelMode },
) {
  if (items.length === 0) return <p className={styles.empty}>{t(locale, 'landingLatestEmpty')}</p>;

  return (
    <ul className={styles.list}>
      {items.map((it) => {
        const snippet = teaser(it.detail);
        return (
          <li key={it.id} className={styles.item}>
            <div className={styles.line}>
              {it.external ? (
                <a href={it.href} target="_blank" rel="noopener noreferrer" className={styles.title}>{it.title}</a>
              ) : (
                <Link href={it.href} className={styles.title}>{it.title}</Link>
              )}
              <span className={styles.meta}>
                {t(locale, KIND_KEY[it.kind])}
                {it.subtitle ? ` · ${it.subtitle}` : ''}
                {it.timestamp ? ` · ${dayLabel(it.timestamp, locale, dateLabels, { year: true })}` : ''}
              </span>
            </div>
            {snippet && <p className={styles.snippet}>{snippet}</p>}
          </li>
        );
      })}
    </ul>
  );
}
