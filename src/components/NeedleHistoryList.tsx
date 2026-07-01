import { NeedleGaugeSvg } from './NeedleGauge';
import Markdown from './Markdown';
import { parseHealth, healthColor } from '../lib/health';
import type { NeedleChange } from '../lib/history';
import styles from './NeedleHistoryList.module.css';

// A scrollable list of "list cards": a compact needle gauge (no UPDATE button) on the
// left, with the health, date, and markdown update note to the right. One card per
// recorded needle change.

export default function NeedleHistoryList({
  changes,
  emptyLabel = 'No updates recorded yet.',
}: {
  changes: NeedleChange[];
  emptyLabel?: string;
}) {
  if (changes.length === 0) {
    return <p className={styles.empty}>{emptyLabel}</p>;
  }

  return (
    <div className={styles.list}>
      {changes.map((c, i) => {
        const health = parseHealth(c.health);
        return (
          <article key={`${c.timestamp}-${i}`} className={styles.card}>
            <div className={styles.gauge}>
              <NeedleGaugeSvg
                progress={c.progress}
                health={c.health}
                previousProgress={c.previousProgress}
                previousHealth={c.previousHealth}
              />
            </div>
            <div className={styles.body}>
              <div className={styles.head}>
                <span className={styles.health} style={{ color: healthColor(health) }}>{health}</span>
                <time className={styles.date} dateTime={c.timestamp}>
                  {new Date(c.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                </time>
              </div>
              {c.notes ? (
                <div className={styles.note}><Markdown>{c.notes}</Markdown></div>
              ) : (
                <div className={styles.noteEmpty}>No note for this update.</div>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
