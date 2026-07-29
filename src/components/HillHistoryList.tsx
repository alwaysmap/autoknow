import { PhaseHillSvg } from './PhaseHillGauge';
import Markdown from './Markdown';
import { hillStatusColor } from '../lib/phase';
import { t, type Locale } from '../lib/i18n';
import type { HillChange } from '../lib/history';
import styles from './NeedleHistoryList.module.css';
import { localDate } from '../lib/dates';

// A scrollable list of "list cards" for a phase's hill-chart updates: a compact hill
// (no UPDATE button) on the left, with the date + who inside the chart's top-left and
// the markdown note to the right. Mirrors NeedleHistoryList; reuses its styles.

// `compact` renders the same cards at popover scale — ONE component owns how a
// phase's progress history looks wherever it is read.
//
// #165 collapsed the old three-block card (chart, then a `In Progress · Jun 1 · by
// seed` meta row, then the note) to chart + note. Two things moved INTO the chart
// rather than just disappearing:
//  - date + source, as the top-left caption PhaseHillSvg now owns (#165) — the
//    curve's own structurally-empty corner, so it's a label on the figure, not a
//    second encoding competing with the curve.
//  - status, as the coin's OWN color: it was previously a colored WORD next to an
//    uncolored coin (identity-colored, one hue per phase). The dot's x already
//    states status by position; recoloring the coin to `hillStatusColor` folds the
//    word's only non-redundant bit (the color) into ink that was already there,
//    instead of carrying it as a fourth encoding of one fact (design.md's "one
//    measure per cell"). Identity color stays on the LIVE gauge, where there is
//    only one entry and no status word to fold.
//
// Axis captions are OFF here, and inkScale compensates for the narrow `.gauge` slot
// (#164): NeedleHistoryList's own gauge (NeedleGaugeSvg) never carried axis text, so
// showing it only on the hill's history was the "history is a separate thing" tell.
// The slots are 8.25rem (this list) and 7rem (compact, widened by #165 from 4rem —
// the top-left caption needs the room the old meta row is no longer spending);
// PhaseHillSvg's authored `1` is tuned against the live card's ~16.25rem
// (`--status-viz-w`), so a flat inkScale=2 lands both slots near the same rendered
// size instead of the 5.3x/2.6x shrink #164 measured.
export default function HillHistoryList({
  changes,
  emptyLabel,
  locale = 'en',
  compact,
}: {
  changes: HillChange[];
  emptyLabel?: string;
  locale?: Locale;
  compact?: boolean;
}) {
  if (changes.length === 0) {
    return <p className={styles.empty}>{emptyLabel ?? t(locale, 'noUpdatesRecorded')}</p>;
  }

  return (
    <div className={compact ? `${styles.list} ${styles.compact}` : styles.list}>
      {changes.map((c, i) => {
        const date = localDate(c.timestamp, locale, { month: 'short', day: 'numeric', year: 'numeric' });
        const caption = c.source ? `${date} · ${t(locale, 'bySource', { name: c.source })}` : date;
        return (
          <article key={`${c.timestamp}-${i}`} className={styles.card}>
            <div className={styles.gauge}>
              <PhaseHillSvg
                progress={c.progress}
                previousProgress={c.previousProgress}
                color={hillStatusColor(c.progress)}
                axisLabels={null}
                caption={caption}
                inkScale={2}
              />
            </div>
            <div className={styles.body}>
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
