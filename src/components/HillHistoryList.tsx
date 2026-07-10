import { PhaseHillSvg } from './PhaseHillGauge';
import Markdown from './Markdown';
import { hillStatus, hillStatusColor } from '../lib/phase';
import type { HillChange } from '../lib/history';
import styles from './NeedleHistoryList.module.css';

// A scrollable list of "list cards" for a phase's hill-chart updates: a compact hill
// (no UPDATE button) on the left, with the status, date, person, and markdown note to
// the right. Mirrors NeedleHistoryList; reuses its styles.

export default function HillHistoryList({
  changes,
  color,
  emptyLabel = 'No updates recorded yet.',
}: {
  changes: HillChange[];
  color: string;
  emptyLabel?: string;
}) {
  if (changes.length === 0) {
    return <p className={styles.empty}>{emptyLabel}</p>;
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
              <span className={styles.health} style={{ color: hillStatusColor(c.progress) }}>{hillStatus(c.progress)}</span>
              <time className={styles.date} dateTime={c.timestamp}>
                {new Date(c.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                {c.source ? ` · by ${c.source}` : ''}
              </time>
            </div>
            {c.notes ? (
              <div className={styles.note}><Markdown>{c.notes}</Markdown></div>
            ) : (
              <div className={styles.noteEmpty}>No note for this update.</div>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}
