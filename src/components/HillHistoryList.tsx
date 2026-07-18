import { PhaseHillSvg } from './PhaseHillGauge';
import Markdown from './Markdown';
import { hillStatusColor } from '../lib/phase';
import { t, statusKey, type Locale } from '../lib/i18n';
import type { HillChange } from '../lib/history';
import styles from './NeedleHistoryList.module.css';
import { localDate } from '../lib/dates';

// A scrollable list of "list cards" for a phase's hill-chart updates: a compact hill
// (no UPDATE button) on the left, with the status, date, person, and markdown note to
// the right. Mirrors NeedleHistoryList; reuses its styles.

export default function HillHistoryList({
  changes,
  color,
  emptyLabel,
  locale = 'en',
}: {
  changes: HillChange[];
  color: string;
  emptyLabel?: string;
  locale?: Locale;
}) {
  if (changes.length === 0) {
    return <p className={styles.empty}>{emptyLabel ?? t(locale, 'noUpdatesRecorded')}</p>;
  }

  return (
    <div className={styles.list}>
      {changes.map((c, i) => (
        <article key={`${c.timestamp}-${i}`} className={styles.card}>
          <div className={styles.gauge}>
            <PhaseHillSvg progress={c.progress} previousProgress={c.previousProgress} color={color} />
          </div>
          <div className={styles.body}>
            <div className={styles.head}>
              <span className={styles.health} style={{ color: hillStatusColor(c.progress) }}>{t(locale, statusKey(c.progress))}</span>
              <time className={styles.date} dateTime={c.timestamp}>
                {localDate(c.timestamp, locale, { month: 'short', day: 'numeric', year: 'numeric' })}
                {c.source ? ` · ${t(locale, 'bySource', { name: c.source })}` : ''}
              </time>
            </div>
            {c.notes ? (
              <div className={styles.note}><Markdown>{c.notes}</Markdown></div>
            ) : (
              <div className={styles.noteEmpty}>{t(locale, 'noNoteForUpdate')}</div>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}
