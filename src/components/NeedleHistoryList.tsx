import { NeedleGaugeSvg } from './NeedleGauge';
import { RelationshipScaleTrack } from './RelationshipScale';
import Markdown from './Markdown';
import { parseHealth, healthColor, HEALTH_KEY } from '../lib/health';
import { deriveScore, REL_KEY } from '../lib/relationship';
import { t, type Locale } from '../lib/i18n';
import type { NeedleChange } from '../lib/history';
import styles from './NeedleHistoryList.module.css';

// A scrollable list of "list cards": a compact status graphic (no UPDATE button) on
// the left, with the state, date, and markdown update note to the right. One card per
// recorded change. Programs keep the needle gauge; partners (relationship=true) get
// the colorless 1..7 scale — relationship health is a position, not a dial.

export default function NeedleHistoryList({
  changes,
  emptyLabel,
  relationship = false,
  locale = 'en',
}: {
  changes: NeedleChange[];
  emptyLabel?: string;
  relationship?: boolean;
  locale?: Locale;
}) {
  if (changes.length === 0) {
    return <p className={styles.empty}>{emptyLabel ?? t(locale, 'noUpdatesRecorded')}</p>;
  }

  return (
    <div className={styles.list}>
      {changes.map((c, i) => {
        const health = parseHealth(c.health);
        const score = relationship ? deriveScore({ relationshipScore: c.score, theNeedle: c.health }) : null;
        const prevScore = relationship && (c.previousScore != null || c.previousHealth != null)
          ? deriveScore({ relationshipScore: c.previousScore, theNeedle: c.previousHealth })
          : null;
        return (
          <article key={`${c.timestamp}-${i}`} className={styles.card}>
            <div className={styles.gauge}>
              {relationship && score !== null ? (
                <RelationshipScaleTrack score={score} previousScore={prevScore} />
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
                  <span className={styles.health}>{score}/5 — {t(locale, REL_KEY[score])}</span>
                ) : (
                  <span className={styles.health} style={{ color: healthColor(health) }}>{t(locale, HEALTH_KEY[health])}</span>
                )}
                <time className={styles.date} dateTime={c.timestamp}>
                  {new Date(c.timestamp).toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' })}
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
