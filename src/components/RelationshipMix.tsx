'use client';

import React from 'react';
import Link from 'next/link';
import { t } from '../lib/i18n';
import { useLocale } from './LocaleProvider';
import { relationshipMix, REL_KEY, REL_SCORES, type RelScore } from '../lib/relationship';
import { RelationshipFace } from './RelationshipFace';
import StatTile from './StatTile';
import styles from './RelationshipMix.module.css';

// The Small Chart: where the whole partner book sits on the 1..5 relationship scale,
// as a 100% stacked bar. Shares are the point — "a third of our relationships are
// strained" is the sentence a leader needs, and it survives the partner count
// changing underneath it.
//
// The scale is COLORLESS by design (lib/relationship): valence is position, not hue,
// and every hue in this palette is already spoken for (health, chain, product bands).
// So the segments run critical → exemplary left to right under a single ink ramp that
// deepens with the score, with the scale's own frown/smile faces at each end of the
// bar to anchor the direction — direct labeling instead of a five-row legend that
// would outweigh the chart. Exact class, count and share live in each segment's
// tooltip and accessible name, and every segment is a door to the partners list
// filtered to that class (design.md §2, §6).

// Ink ramp, faint (critical) → solid (exemplary). Percentages of --fg so it inverts
// correctly with the theme.
const SEG_INK: Record<RelScore, string> = {
  1: 'color-mix(in srgb, var(--fg) 16%, transparent)',
  2: 'color-mix(in srgb, var(--fg) 32%, transparent)',
  3: 'color-mix(in srgb, var(--fg) 50%, transparent)',
  4: 'color-mix(in srgb, var(--fg) 70%, transparent)',
  5: 'color-mix(in srgb, var(--fg) 92%, transparent)',
};

interface RelationshipMixProps {
  /** Latest relationship score per partner; null = never rated. */
  scores: (number | null)[];
}

export default function RelationshipMix({ scores }: RelationshipMixProps) {
  const locale = useLocale();
  const { buckets, rated, unrated } = relationshipMix(scores);
  const pct = (share: number) => `${Math.round(share * 100)}%`;
  // "Rated" is the OR of every scored class — repeated per-column params are the
  // funnel's own multi-select grammar (design.md §6), so the count and the list it
  // opens always agree.
  const ratedHref = `/partners?${REL_SCORES.map((s) => `relationship=${s}`).join('&')}`;

  return (
    <StatTile
      testId="relationship-mix"
      label={t(locale, 'statsRelationshipMix')}
      sub={
        <>
          <Link href={ratedHref} title={t(locale, 'statsRelationshipRatedTitle')}>
            {t(locale, 'statsRelationshipRated', { n: rated.toLocaleString(locale) })}
          </Link>
          {/* Unrated partners are out of the denominator; say so — and let a reader
              jump straight to the ones still needing a first reading. */}
          {unrated > 0 && (
            <>
              {' · '}
              <Link href="/partners?relationship=unrated" title={t(locale, 'statsRelationshipUnratedTitle')}>
                {t(locale, 'statsRelationshipUnrated', { n: unrated.toLocaleString(locale) })}
              </Link>
            </>
          )}
        </>
      }
    >
      <div className={styles.row}>
        {rated === 0 ? (
          <div className={styles.empty} role="img" aria-label={t(locale, 'statsRelationshipNone')} />
        ) : (
          <>
            <span className={styles.pole} aria-hidden>
              <RelationshipFace score={1} size={16} decorative />
            </span>
            {/* `group`, not `img`: the segments are links, and an img role would
                collapse the subtree and hide them from assistive tech. */}
            <div className={styles.bar} role="group" aria-label={t(locale, 'statsRelationshipMixAria')}>
              {buckets
                .filter((b) => b.count > 0)
                .map((b) => {
                  const name = `${t(locale, REL_KEY[b.score])} — ${t(locale, 'statsRelationshipSegment', {
                    n: b.count.toLocaleString(locale),
                    p: pct(b.share),
                  })}`;
                  return (
                    <Link
                      key={b.score}
                      // Canonical token the /partners relationship funnel filters on
                      // (PartnersClient filterValue) — locale-stable, unlike the
                      // display label.
                      href={`/partners?relationship=${b.score}`}
                      className={styles.seg}
                      style={{ flexGrow: b.count, ['--seg-ink' as string]: SEG_INK[b.score] }}
                      title={name}
                      aria-label={name}
                    />
                  );
                })}
            </div>
            <span className={styles.pole} aria-hidden>
              <RelationshipFace score={5} size={16} decorative />
            </span>
          </>
        )}
      </div>
    </StatTile>
  );
}
