'use client';

import { NeedleGaugeSvg } from './NeedleGaugeSvg';
import { RelationshipFace, RelationshipNoValue } from './RelationshipFace';
import Markdown from './Markdown';
import { parseHealth, healthColor, HEALTH_KEY } from '../lib/health';
import { deriveScore, REL_KEY } from '../lib/relationship';
import { t, type Locale } from '../lib/i18n';
import type { NeedleChange } from '../lib/history';
import styles from './NeedleHistoryList.module.css';
import { localDate } from '../lib/dates';
import { useScrollToAddressed, addressedAttrs } from '../lib/useScrollToAddressed';

// A scrollable list of "list cards": a compact status graphic (no UPDATE button) on
// the left, with the state, date, and markdown update note to the right. One card per
// recorded change. Programs keep the needle gauge; partners (relationship=true) get
// the colorless 1..7 scale — relationship health is a position, not a dial.
//
// Addressing — the marker and the scroll — comes from `lib/useScrollToAddressed`, which
// every hash-addressable log in the app shares (autoknow-51j).

export default function NeedleHistoryList({
  changes,
  emptyLabel,
  relationship = false,
  locale = 'en',
  highlightId = null,
  scrollToHighlight = false,
}: {
  changes: NeedleChange[];
  emptyLabel?: string;
  relationship?: boolean;
  locale?: Locale;
  /** The one update a deep link addressed (#111) — marked so a reader who followed
   *  `#relationship-update-42` can see WHICH entry they were sent to. The card
   *  carries `data-update-id` regardless, so the opener can scroll it into view. */
  highlightId?: number | null;
  /** Is the surface holding this list actually visible? A scroll into a `display:none`
   *  popover does nothing, so the caller passes its own open state and the scroll
   *  re-fires the moment it opens. */
  scrollToHighlight?: boolean;
}) {
  const listRef = useScrollToAddressed(highlightId, scrollToHighlight, changes);

  if (changes.length === 0) {
    return <p className={styles.empty}>{emptyLabel ?? t(locale, 'noUpdatesRecorded')}</p>;
  }

  return (
    <div className={styles.list} ref={listRef}>
      {changes.map((c) => {
        const health = parseHealth(c.health);
        const score = relationship ? deriveScore({ relationshipScore: c.score, theNeedle: c.health }) : null;
        // The prior value, when this update changed it: shown as a gray face with an
        // arrow to the new (darker, larger) face.
        const priorScore =
          relationship && (c.previousScore != null || c.previousHealth != null)
            ? deriveScore({ relationshipScore: c.previousScore, theNeedle: c.previousHealth })
            : null;
        return (
          <article
            key={c.id}
            className={styles.card}
            {...addressedAttrs(c.id, highlightId)}
          >
            <div className={styles.gauge}>
              {relationship && score !== null ? (
                <span className={styles.relFaces}>
                  {/* Prior slot: previous face, or a "was unrated" glyph on the first
                      rating (health went from nothing to a value). Hidden if unchanged. */}
                  {priorScore !== score && (
                    <>
                      <span className={styles.priorFace}>
                        {priorScore !== null
                          ? <RelationshipFace score={priorScore} size={24} decorative />
                          : <RelationshipNoValue size={24} decorative />}
                      </span>
                      <span className={styles.relArrow} aria-hidden>
                        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 8 h9 M9 5 l3 3 -3 3" />
                        </svg>
                      </span>
                    </>
                  )}
                  <span className={styles.currentFace}>
                    <RelationshipFace score={score} size={30} />
                  </span>
                </span>
              ) : (
                <NeedleGaugeSvg
                  progress={c.progress}
                  health={c.health}
                  previousProgress={c.previousProgress}
                  previousHealth={c.previousHealth}
                />
              )}
            </div>
            <div className={styles.body}>
              <div className={styles.head}>
                {relationship && score !== null ? (
                  <span className={styles.health}>{t(locale, REL_KEY[score])}</span>
                ) : (
                  <span className={styles.health} style={{ color: healthColor(health) }}>{t(locale, HEALTH_KEY[health])}</span>
                )}
                {/* who filed it, then when — provenance before timestamp so the
                    eye picks up the author while scanning the log */}
                {c.source && <span className={styles.author}>{t(locale, 'byAuthor', { name: c.source })}</span>}
                <time className={styles.date} dateTime={c.timestamp}>
                  {localDate(c.timestamp, locale, { month: 'short', day: 'numeric', year: 'numeric' })}
                </time>
              </div>
              {c.notes ? (
                <div className={styles.note}><Markdown>{c.notes}</Markdown></div>
              ) : (
                <div className={styles.noteEmpty}>{t(locale, 'noNoteForUpdate')}</div>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
