'use client';

import Link from 'next/link';
import type { FeedItem } from '../lib/feed';
import Markdown from './Markdown';
import { NeedleGaugeSvg } from './NeedleGaugeSvg';
import { RelationshipFace, RelationshipNoValue } from './RelationshipScale';
import { parseScore } from '../lib/relationship';
import { PhaseHillSvg } from './PhaseHillGauge';
import { deleteFeedItem } from '../app/actions/status';
import { t, type Locale } from '../lib/i18n';
import { useLocale } from './LocaleProvider';
import AiBadge from './AiBadge';
import KindBox from './KindBox';
import styles from './FeedList.module.css';
import { localDate } from '../lib/dates';

// One presentational list for both search results and the activity feed. Renders a
// relevance "% match" when the item carries a score, otherwise a date when it carries
// a timestamp. Purely presentational; a client component so it can read the locale
// from context wherever it's mounted (activity pages, UnifiedSearch).


function aside(it: FeedItem, locale: Locale): string {
  // Search results are already ordered by relevance — never surface the numeric score.
  if (typeof it.score === 'number') return '';
  if (it.timestamp) {
    return localDate(it.timestamp, locale, { month: 'short', day: 'numeric', year: 'numeric' });
  }
  return '';
}

export default function FeedList({
  items,
  emptyLabel,
  deletable = false,
  revalidate,
}: {
  items: FeedItem[];
  emptyLabel?: string;
  deletable?: boolean; // show a remove control per entry (activity surfaces only)
  revalidate?: string; // path to revalidate after a delete
}) {
  const locale = useLocale();
  if (items.length === 0) return <p className={styles.empty}>{emptyLabel ?? t(locale, 'nothingHereYet')}</p>;

  return (
    <div className={styles.list}>
      {items.map((it) => (
        <article key={it.id} className={styles.item}>
          {it.relationship ? (
            <div className={styles.gauge}>
              {/* prior (gray) → arrow → current (dark) faces — the relationship's move */}
              {(() => {
                const cur = parseScore(it.relationship.score) ?? 3;
                const prior = it.relationship.previousScore != null ? parseScore(it.relationship.previousScore) : null;
                return (
                  <span className={styles.relFaces}>
                    {/* Prior slot: previous face, or a "was unrated" glyph on the first
                        rating (nothing → first value). Hidden if unchanged. */}
                    {prior !== cur && (
                      <>
                        <span className={styles.priorFace}>
                          {prior != null
                            ? <RelationshipFace score={prior} size={22} decorative />
                            : <RelationshipNoValue size={22} decorative />}
                        </span>
                        <span className={styles.relArrow} aria-hidden>
                          <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 8 h9 M9 5 l3 3 -3 3" />
                          </svg>
                        </span>
                      </>
                    )}
                    <span className={styles.currentFace}>
                      <RelationshipFace score={cur} size={28} />
                    </span>
                  </span>
                );
              })()}
            </div>
          ) : it.needle ? (
            <div className={styles.gauge}>
              <NeedleGaugeSvg
                progress={it.needle.progress}
                health={it.needle.health}
                previousProgress={it.needle.previousProgress}
                previousHealth={it.needle.previousHealth}
              />
            </div>
          ) : it.hill ? (
            <div className={styles.gauge}>
              <PhaseHillSvg progress={it.hill.progress} previousProgress={it.hill.previousProgress} color={it.hill.color} label={it.title} />
            </div>
          ) : (
            <div className={styles.kind}><KindBox kind={it.kind} locale={locale} /></div>
          )}
          <div className={styles.body}>
            <div className={styles.head}>
              {it.external ? (
                <a className={styles.title} href={it.href} target="_blank" rel="noopener noreferrer">{it.title}</a>
              ) : (
                // A hash href is a STATE fragment (#phase-:id-detail, #status-history) with no
                // scroll target, so Next would jump to the page top (#40); scroll={false} keeps
                // the reader's place and lets the popover open.
                <Link className={styles.title} href={it.href} scroll={it.href.includes('#') ? false : undefined}>{it.title}</Link>
              )}
              <span className={styles.aside}>{aside(it, locale)}</span>
              {deletable && (
                <form action={deleteFeedItem} style={{ display: 'inline-flex' }}>
                  <input type="hidden" name="id" value={it.id} />
                  {revalidate && <input type="hidden" name="revalidate" value={revalidate} />}
                  <button type="submit" title={t(locale, 'removeThisUpdate')} aria-label={t(locale, 'removeLabel')}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted, #aaa)', fontSize: '0.8125rem', lineHeight: 1, padding: '0 0.125rem' }}>
                    ✕
                  </button>
                </form>
              )}
            </div>
            {it.subtitle && <div className={styles.meta}>{it.subtitle}</div>}
            {it.detail && (
              <div className={styles.detail}>
                {/* context details are Gemini digests/deltas, never human prose (design.md §8) */}
                {it.kind === 'context' && <div className={styles.aiMark}><AiBadge /></div>}
                <Markdown>{it.detail}</Markdown>
              </div>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}
