'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { t } from '../lib/i18n';
import { useLocale } from './LocaleProvider';
import { localDate } from '../lib/dates';
import { healthColor, healthKey, parseHealth, HEALTHS, type Health } from '../lib/health';
import AnchoredPopover from './AnchoredPopover';
import { monthTicks, sortByUrgency, type TimelineLayout, type TimelineMark } from '../lib/programTimeline';
import styles from './ProgramTimeline.module.css';

// The portfolio whisker chart (#159): one horizontal mark per program on a shared time
// axis, answering the question neither /programs' table nor CapacityChart can — WHEN does
// this portfolio land, and what is bunched against what.
//
// A pure renderer over `TimelineLayout`. It does not query and does not derive; each
// surface decides WHICH programs it plots and hands the same shape across, so /ecosystem
// and the popped form are one component over one shape (#159's "one shape, two pages").
//
// DOM AND CSS, NOT SVG, and that is the point. design.md §9b says a chart fills its
// container's inline size and owns its own height in rem; the `viewBox` charts here scale
// height by width instead. For THIS chart that failure is not cosmetic — a fixed-aspect
// viewBox renders ~4px per lane at the 360px compliance width, where this renders 20px. So: x is a percentage of the time window (no measurement, which
// §9b also bans), y is whole-pixel rem lanes, and the height follows the lane count.
//
// Each whisker is a real `<a href>`: keyboard-reachable and a genuine URL for free
// (design.md §2), rather than an SVG hit-rect with hand-rolled focus.

export interface ProgramTimelineProps {
  layout: TimelineLayout;
  /** Counted and stated, never silently dropped — e.g. /ecosystem plots Active only. */
  filteredOut?: number;
  /**
   * Where to GO to see the programs `filteredOut` counts. Optional, and supplied by the
   * page rather than built here: the surface that decided which programs to omit is the
   * only one that can name them, so the link lands on exactly those rows instead of on a
   * guess at what "not in flight" means (design.md §2 — a stated exclusion the reader
   * cannot act on is half a fact).
   */
  filteredOutHref?: string;
}

const LANE_REM = 1.25;
/** Passed explicitly, not left to `monthTicks`' default: the phone breakpoint in the module
 *  CSS hides every other tick, and that rule is only correct for THIS number. The two ends
 *  of that coupling should be visible to each other. */
const MAX_TICKS = 8;

// The time scale is INSET by half the widest dot at each end, so a mark sitting on a window
// boundary paints in full instead of being sliced in half by the scrollport's edge — which
// reads as a different glyph, not as a clipped one (2px of a 7px dot, seen on the portfolio's
// last SOP). The obvious fix does not work here: `overflow-x: clip` + `overflow-clip-margin`
// computes back to `hidden` because `overflow-y: auto` forces the other axis to a scrolling
// value, so the margin is discarded.
//
// Applied through these two helpers ONLY, and to the axis ticks as well as the marks — the
// two must share one scale or the tick labels stop naming the position they sit above.
const INSET = '0.25rem';
/** The x of a point on the scale, as a CSS length. */
const at = (p: number) => `calc(${INSET} + (100% - ${INSET} * 2) * ${p / 100})`;
/** The width of a span on the scale, as a CSS length. */
const across = (p: number) => `calc((100% - ${INSET} * 2) * ${p / 100})`;

export default function ProgramTimeline({ layout, filteredOut = 0, filteredOutHref }: ProgramTimelineProps) {
  const locale = useLocale();
  const { windowMinMs, windowMaxMs, nowMs, excludedNoDates } = layout;

  // Which health bands are shown. All on by default — a chart that opened filtered would be
  // lying about the portfolio by omission.
  const [hidden, setHidden] = useState<ReadonlySet<Health>>(new Set());
  const [active, setActive] = useState<TimelineMark | null>(null);

  // Re-row after filtering so hiding a band CLOSES its rows rather than leaving the chart
  // full of blank ones. Re-sorted through the SAME function the server used, so a filtered
  // chart and an unfiltered one cannot order by different rules. The window is deliberately
  // NOT recomputed — a shared time axis that moved when you toggled a filter would make two
  // readings incomparable, which is the whole reason the axis is anchored.
  const marks = useMemo(() => {
    const kept = layout.marks.filter((m) => !hidden.has(parseHealth(m.health)));
    return sortByUrgency(kept).map((m, i) => ({ ...m, lane: i }));
  }, [layout.marks, hidden]);
  const laneCount = marks.length;

  const span = Math.max(1, windowMaxMs - windowMinMs);
  const pct = (ms: number) => ((ms - windowMinMs) / span) * 100;

  const toggle = (h: Health) => setHidden((prev) => {
    const next = new Set(prev);
    if (next.has(h)) next.delete(h); else next.add(h);
    return next;
  });

  return (
    <div className={styles.wrap}>
      {/* Filter by health — the same vocabulary and the same colours as the dots, so the
          control reads as the legend it also is. Counts come from the UNFILTERED layout, so
          a hidden band still says how much it is hiding. */}
      <div className={styles.filters} role="group" aria-label={t(locale, 'timelineFilterLabel')}>
        {HEALTHS.map((h) => {
          const n = layout.marks.filter((m) => parseHealth(m.health) === h).length;
          const off = hidden.has(h);
          return (
            <button
              key={h}
              type="button"
              className={`${styles.filter} ${off ? styles.filterOff : ''}`}
              aria-pressed={!off}
              onClick={() => toggle(h)}
            >
              <span className={styles.swatch} style={{ background: healthColor(h) }} aria-hidden="true" />
              {t(locale, healthKey(h))} <span className={styles.count}>{n}</span>
            </button>
          );
        })}
        <AnchoredPopover
          variant="panel"
          panelLabel={t(locale, 'timelineLegend')}
          panelClassName={styles.legendPanel}
          renderTrigger={(p) => (
            <button {...p} type="button" className={styles.legendBtn} aria-label={t(locale, 'timelineLegend')}>ⓘ</button>
          )}
        >
          <ul className={styles.legendList}>
            <li><span className={styles.legendStart} aria-hidden="true" /> {t(locale, 'timelineLegendStart')}</li>
            <li><span className={styles.legendSop} aria-hidden="true" /> {t(locale, 'timelineLegendSop')}</li>
            <li><span className={styles.legendForecast} aria-hidden="true" /> {t(locale, 'timelineLegendForecast')}</li>
            <li><span className={styles.legendOvershoot} aria-hidden="true" /> {t(locale, 'timelineLegendOvershoot')}</li>
            <li><span className={styles.legendToday} aria-hidden="true" /> {t(locale, 'timelineLegendToday')}</li>
          </ul>
        </AnchoredPopover>
      </div>

      {marks.length === 0 ? (
        // Two different facts, and telling the reader the wrong one is worse than silence:
        // "every band is hidden" is actionable (turn one back on) and "nothing to plot" is
        // not, so they must not be swapped. Keyed on the UNFILTERED layout, which is the
        // only thing that can tell them apart.
        <p className={styles.empty} role="status">
          {t(locale, layout.marks.length === 0 ? 'timelineEmpty' : 'timelineAllHidden')}
        </p>
      ) : (
        <div className={styles.plot}>
          <div className={styles.track} style={{ height: `calc(${laneCount} * ${LANE_REM}rem + 1rem)` }}>
            <div className={styles.today} style={{ left: at(pct(nowMs)) }} aria-hidden="true" />

            {marks.map((m) => {
              const points = [m.startMs, m.sopMs, m.finishMs].filter((d): d is number => d != null);
              const from = Math.min(...points);
              const to = Math.max(...points);
              // The overshoot is the news, and it is derived from the DATA — a finish after
              // the SOP — never from which side a segment is authored on (AGENTS lesson 18).
              const late = m.sopMs != null && m.finishMs != null && m.finishMs > m.sopMs;
              return (
                <Link
                  key={m.id}
                  href={`/programs/${m.id}`}
                  className={styles.mark}
                  style={{ top: `${m.lane * LANE_REM}rem`, left: at(pct(from)), width: across(pct(to) - pct(from)) }}
                  aria-label={markTitle(locale, m)}
                  // No `title`: the native tooltip waits about a second before appearing,
                  // which on a chart you read by sweeping across it is long enough that the
                  // information may as well not be there. The readout below is immediate.
                  onMouseEnter={() => setActive(m)}
                  onMouseLeave={() => setActive(null)}
                  onFocus={() => setActive(m)}
                  onBlur={() => setActive(null)}
                >
                  <span className={styles.hairline} aria-hidden="true" />
                  {late && (
                    <span
                      className={styles.overshoot}
                      style={{
                        left: within(m.sopMs!, from, to),
                        width: `${((m.finishMs! - m.sopMs!) / Math.max(1, to - from)) * 100}%`,
                      }}
                      aria-hidden="true"
                    />
                  )}
                  {m.startMs != null && <span className={styles.minor} style={{ left: within(m.startMs, from, to) }} aria-hidden="true" />}
                  {/* The forecast finish is a DIAMOND, not another circle: it is the one mark
                      that is an estimate rather than a recorded or committed date, and shape
                      carries that distinction at any size — a reader should not have to
                      compare fills to tell a projection from a fact. */}
                  {m.finishMs != null && <span className={styles.forecast} style={{ left: within(m.finishMs, from, to) }} aria-hidden="true" />}
                  {/* The SOP dot carries HEALTH, not SOP outlook: the dot says how the program
                      is doing and the geometry says whether it lands on time — one measure per
                      encoding (design.md §6). Absent when there is no target date, which is
                      itself the reading. */}
                  {m.sopMs != null && (
                    <span
                      className={styles.sop}
                      style={{ left: within(m.sopMs, from, to), background: healthColor(m.health) }}
                      aria-hidden="true"
                    />
                  )}
                </Link>
              );
            })}
          </div>

          {/* The axis lives INSIDE the scrollport, stuck to its bottom edge. Two reasons, and
              the second is the one that bites: it stays put while rows scroll past it, which
              is the anchored axis this chart promises; and it shares the marks' content box
              exactly, so a scrollbar cannot narrow the plot while leaving the ticks full
              width — which would put marks and their own labels on scales differing by the
              scrollbar's width. Overlay scrollbars (macOS) hide that class of bug entirely. */}
          <div className={styles.axis} aria-hidden="true">
            {monthTicks(windowMinMs, windowMaxMs, MAX_TICKS).map((ms) => {
              const p = pct(ms);
              return (
                <span key={ms} className={styles.tick} style={{ left: at(p), transform: tickShift(p) }}>
                  {localDate(new Date(ms), locale, { month: 'short', year: '2-digit' })}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* The readout. Reserved height so the chart above does not jump as the pointer sweeps
          across marks — the one thing a reader comparing programs cannot tolerate.
          Each date carries the SAME glyph the plot draws for it, so the reader learns the
          mark grammar by using the chart rather than by opening the legend. */}
      <div className={styles.readout} data-testid="timeline-readout">
        {active ? (
          <>
            <strong className={styles.readoutName} style={{ color: healthColor(active.health) }}>
              {active.name}
            </strong>
            {/* CHRONOLOGICAL, not a fixed field order: the reader is looking at a time axis,
                so a readout that always said "SOP then forecast" would contradict the
                geometry every time the forecast lands first. Sorting by the date itself
                means the sentence and the whisker tell the same story left to right. */}
            {readoutFacts(locale, active).map((f) => (
              <span key={f.key} className={styles.readoutFact}>
                <span className={f.glyph} style={f.style} aria-hidden="true" />
                {f.text}
              </span>
            ))}
            {active.sopMs == null && (
              <span className={styles.readoutFact}>{t(locale, 'timelineNoSop')}</span>
            )}
          </>
        ) : <span className={styles.hint}>{t(locale, 'timelineHint')}</span>}
      </div>

      {(excludedNoDates > 0 || filteredOut > 0) && (
        <p className={styles.note}>
          {excludedNoDates > 0 && t(locale, 'timelineNoDates', { n: excludedNoDates })}
          {excludedNoDates > 0 && filteredOut > 0 ? ' · ' : ''}
          {filteredOut > 0 && (filteredOutHref
            ? <Link href={filteredOutHref} className={styles.noteLink}>{t(locale, 'timelineFilteredOut', { n: filteredOut })}</Link>
            : t(locale, 'timelineFilteredOut', { n: filteredOut }))}
        </p>
      )}
    </div>
  );
}

/**
 * How far to pull a tick label back from the point it names.
 *
 * Centred, except within a hair of either end, where a centred label would hang outside the
 * container. Keyed on the POSITION, never on `:first-child`/`:last-child`, which is what
 * this replaced: `monthTicks` thins by a fixed step, so its final tick is only at 100% when
 * the month count happens to divide — for a 9-, 11-, 13-, 16- or 20-month window it lands at
 * 89–94%, and a `:last-child` right-align there displaces the label half its own width from
 * the date it labels. The bug was live on the shipped 29-month view.
 */
const tickShift = (p: number) =>
  p < 1 ? 'none' : p > 99 ? 'translateX(-100%)' : 'translateX(-50%)';

/** A dot's position WITHIN its own mark, which is what `left` is relative to. */
const within = (ms: number, from: number, to: number) =>
  `${((ms - from) / Math.max(1, to - from)) * 100}%`;

/** The whole per-mark story, for the readout AND the link's accessible name. There are
 *  deliberately NO per-mark labels in the plot: forty program names on a shared axis is a
 *  collision problem with no good answer. */
/** The dated facts a mark carries, in TIME order. A mark with no SOP contributes no SOP
 *  fact; the caller states that absence separately, since it has no date to sort by. */
function readoutFacts(locale: ReturnType<typeof useLocale>, m: TimelineMark) {
  const facts: { key: string; ms: number; glyph: string; style?: React.CSSProperties; text: string }[] = [];
  if (m.startMs != null) {
    facts.push({ key: 'start', ms: m.startMs, glyph: styles.legendStart, text: t(locale, 'timelineStarted', { d: day(locale, m.startMs) }) });
  }
  if (m.sopMs != null) {
    facts.push({ key: 'sop', ms: m.sopMs, glyph: styles.legendSop, style: { background: healthColor(m.health) }, text: t(locale, 'timelineSop', { d: day(locale, m.sopMs) }) });
  }
  if (m.finishMs != null) {
    facts.push({ key: 'forecast', ms: m.finishMs, glyph: styles.legendForecast, text: t(locale, 'timelineForecast', { d: day(locale, m.finishMs) }) });
  }
  return facts.sort((a, b) => a.ms - b.ms);
}

const day = (locale: ReturnType<typeof useLocale>, ms: number) =>
  localDate(new Date(ms), locale, { year: 'numeric', month: 'short', day: 'numeric' });

/** The same facts as the readout, flattened — this is the LINK's accessible name, which must
 *  be a string, so it cannot carry the glyphs and says the words instead. */
function markTitle(locale: ReturnType<typeof useLocale>, m: TimelineMark): string {
  const parts = [m.name];
  if (m.startMs != null) parts.push(t(locale, 'timelineStarted', { d: day(locale, m.startMs) }));
  parts.push(m.sopMs != null ? t(locale, 'timelineSop', { d: day(locale, m.sopMs) }) : t(locale, 'timelineNoSop'));
  if (m.finishMs != null) parts.push(t(locale, 'timelineForecast', { d: day(locale, m.finishMs) }));
  return parts.join(' · ');
}
