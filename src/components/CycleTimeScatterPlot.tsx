'use client';

import ChartLabel from './ChartLabel';
import React, { useMemo, useState } from 'react';
import { baselineToCentreY, centreToBaselineY, dodgeLabels, estimateTextWidth, halfHFor } from '../lib/labelPlacement';
import { t } from '../lib/i18n';
import { useLocale } from './LocaleProvider';
import { localDate } from '../lib/dates';
import { phaseHref } from '../lib/phase';
import styles from './CycleTimeScatterPlot.module.css';

// Cycle time as ONE population: every COMPLETED phase is a point, plotted where it landed
// (x) against how long it took (y), with the empirical percentiles as horizontal reference
// lines across the whole chart.
//
// Completed work ONLY. An in-flight phase has an elapsed time, not a cycle time: it enters
// the sample at less than its eventual duration, so including it drags every percentile
// down and makes the portfolio look faster than it is. "How long has this been open, and is
// that unusual" is a real question, but it is a different chart — Aging WIP — and the
// filter lives at the data boundary (lib/dashboardData) so this component cannot be handed
// unfinished work by a future caller.
//
// It used to be one ROW PER PHASE NAME, and that was a false classification. It split a
// 67-point sample into 44 buckets averaging 1.5 items each, so most of the "P50"s it drew
// were a single observation wearing a percentile's name; four buckets were the same phase
// split by capitalisation. It also made the chart's height a function of the portfolio's
// vocabulary — 44 rows, ~3800px — for no analytical return. Treating the phases as equal
// costs nothing real: what the reader wanted from the row labels is WHICH phase a point is,
// and that is a hover away.
//
// Shape follows dvhthomas/flowmetrics, whose cycle-time chart is per-item points under
// empirical P50/P85/P95 reference lines. Two things borrowed deliberately: the percentiles
// are EMPIRICAL (drawn from completed work, never a model), and they ship with their sample
// size, because a P85 over 43 items and one over 3 are different claims and only the chart
// can say which this is.

export interface CycleTimeData {
  phaseId: number;
  phaseName: string;
  projectId: number;
  programName: string;
  /** ISO. Every point here is FINISHED work, so this is always a real completion date. */
  finishedAt: string;
  cycleTimeDays: number;
}

export interface CycleTimeStats {
  p50: number;
  p85: number;
  p95: number;
  /** How many FINISHED phases the three figures above were computed from. */
  sampleSize: number;
}

interface CycleTimeScatterPlotProps {
  data: CycleTimeData[];
  stats: CycleTimeStats | null;
}

/** A percentile worth drawing needs a sample that could actually produce it: below this many
 *  finished phases the lines are noise dressed as a threshold, so the chart says so instead
 *  of drawing them. Flowmetrics carries the same idea as its "smell" flag. */
const MIN_SAMPLE = 5;

/** Mirrors `.percentileLabel`'s font-size — the box estimate has to match the type it is
 *  reserving room for, and the cascade is not readable from here. */
const CAPTION_FS = 10;

const width = 800;
const height = 380;
const marginLeft = 56;
const marginRight = 90; // room for the percentile captions, which sit in the right gutter
const marginTop = 24;
const marginBottom = 44;

export default function CycleTimeScatterPlot({ data, stats }: CycleTimeScatterPlotProps) {
  const locale = useLocale();
  const [selected, setSelected] = useState<CycleTimeData | null>(null);

  const maxDays = useMemo(() => {
    const ceiling = Math.max(...data.map((d) => d.cycleTimeDays), stats?.p95 ?? 0, 10);
    return Math.ceil(ceiling / 10) * 10;
  }, [data, stats]);

  const timeRange = useMemo(() => {
    const times = data.map((d) => new Date(d.finishedAt).getTime());
    const min = Math.min(...times);
    const max = Math.max(...times);
    // A portfolio whose phases all landed the same day would divide by zero; give it a day
    // of width so the points spread instead of stacking on the axis.
    return { min, max: max > min ? max : min + 86_400_000 };
  }, [data]);

  if (data.length === 0) {
    return (
      <div className={styles.empty} role="status">
        <p>{t(locale, 'notEnoughCycleTime')}</p>
      </div>
    );
  }

  const innerWidth = width - marginLeft - marginRight;
  const innerHeight = height - marginTop - marginBottom;
  const xScale = (iso: string) =>
    marginLeft + ((new Date(iso).getTime() - timeRange.min) / (timeRange.max - timeRange.min)) * innerWidth;
  const yScale = (days: number) => marginTop + innerHeight - (days / maxDays) * innerHeight;

  const yTicks: number[] = [];
  for (let d = 0; d <= maxDays; d += Math.max(10, Math.round(maxDays / 5))) yTicks.push(d);

  // Four evenly spaced dates across the window — the axis is a time RANGE, so the ticks are
  // positions in it rather than one per datum.
  const xTicks = [0, 1, 2, 3].map((i) => timeRange.min + ((timeRange.max - timeRange.min) * i) / 3);

  const showPercentiles = stats !== null && stats.sampleSize >= MIN_SAMPLE;
  const rawBands = showPercentiles
    ? [
      { key: 'p50', days: stats.p50, label: 'P50' },
      { key: 'p85', days: stats.p85, label: 'P85' },
      { key: 'p95', days: stats.p95, label: 'P95' },
    ]
    : [];

  // The captions ride at their own line's height, so a TIGHT distribution stacks them —
  // and a tight distribution is the HEALTHY one, which is exactly why this cannot be left
  // to chance (AGENTS lesson 19). `dodgeLabels`, not `keepNonOverlapping`: all three are
  // distinct facts and no scale on this chart lets a reader recover a hidden one, so they
  // get nudged in y rather than dropped. The LINES stay on their true values; only the
  // captions move, which is the whole point of separating ink from label.
  const captionYs = dodgeLabels(
    [],
    rawBands.map((b) => ({
      x: width - marginRight + 6,
      y: baselineToCentreY(yScale(b.days), CAPTION_FS),
      halfW: estimateTextWidth(`${b.label} · ${t(locale, 'daysShort', { n: b.days })}`, CAPTION_FS) / 2,
      halfH: halfHFor(CAPTION_FS),
      priority: 0,
    })),
    { top: marginTop, bottom: height - marginBottom },
  );
  const bands = rawBands.map((b, i) => ({ ...b, captionY: centreToBaselineY(captionYs[i], CAPTION_FS) }));

  return (
    <div className={styles.container}>
      <svg className={styles.svg} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet"
        role="img" aria-label={t(locale, 'cycleTimeTitle')}>
        <line x1={marginLeft} y1={marginTop} x2={marginLeft} y2={height - marginBottom} className={styles.axisLine} />
        <line x1={marginLeft} y1={height - marginBottom} x2={width - marginRight} y2={height - marginBottom} className={styles.axisLine} />

        {yTicks.map((tick) => (
          <g key={`y-${tick}`}>
            <line x1={marginLeft - 4} y1={yScale(tick)} x2={marginLeft} y2={yScale(tick)} className={styles.axisLine} />
            <ChartLabel x={marginLeft - 8} y={yScale(tick)} textAnchor="end" dominantBaseline="middle" className={styles.axisLabel}>
              {t(locale, 'daysShort', { n: tick })}
            </ChartLabel>
          </g>
        ))}

        {xTicks.map((ms, i) => (
          <g key={`x-${i}`}>
            <line x1={xScale(new Date(ms).toISOString())} y1={height - marginBottom} x2={xScale(new Date(ms).toISOString())} y2={height - marginBottom + 4} className={styles.axisLine} />
            <ChartLabel x={xScale(new Date(ms).toISOString())} y={height - marginBottom + 18} textAnchor="middle" className={styles.axisLabel}>
              {localDate(new Date(ms), locale, { month: 'short', day: 'numeric' })}
            </ChartLabel>
          </g>
        ))}

        {/* The reference lines. Horizontal and full-width because they describe the whole
            population — the thing the per-phase-name version could never say. */}
        {bands.map((b) => (
          <g key={b.key}>
            <line x1={marginLeft} y1={yScale(b.days)} x2={width - marginRight} y2={yScale(b.days)} className={styles.percentileLine} />
            <ChartLabel data-testid={`cycle-${b.key}`} x={width - marginRight + 6} y={b.captionY} className={styles.percentileLabel}>
              {b.label} · {t(locale, 'daysShort', { n: b.days })}
            </ChartLabel>
          </g>
        ))}

        {data.map((d) => (
          <circle
            key={d.phaseId}
            cx={xScale(d.finishedAt)}
            cy={yScale(d.cycleTimeDays)}
            r={5}
            className={`${styles.point} ${selected?.phaseId === d.phaseId ? styles.pointSelected : ''}`}
            onClick={() => setSelected(d)}
            onMouseEnter={() => setSelected(d)}
            tabIndex={0}
            role="button"
            aria-label={t(locale, 'cyclePointTitle', { name: d.phaseName, n: d.cycleTimeDays })}
            onFocus={() => setSelected(d)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelected(d); }}
          >
            {/* The native tooltip stays: it is what a mouse user gets before they click, and
                it is the only detail a printed or screenshotted chart can carry. */}
            <title>{t(locale, 'cyclePointTitle', { name: d.phaseName, n: d.cycleTimeDays })}</title>
          </circle>
        ))}
      </svg>

      {/* The detail panel replaces the y-axis labels the old shape spent 44 rows on. It is
          BELOW the chart, not floating over it: a panel that follows the pointer covers the
          neighbouring points a reader is trying to compare against. */}
      <div className={styles.detail} aria-live="polite">
        {selected ? (
          <p className={styles.detailLine}>
            <a href={phaseHref(selected.projectId, selected.phaseId)} className={styles.detailLink}>
              {selected.phaseName}
            </a>
            {' · '}{selected.programName}
            {' · '}{t(locale, 'daysShort', { n: selected.cycleTimeDays })}
            {' · '}{localDate(new Date(selected.finishedAt), locale, { year: 'numeric', month: 'short', day: 'numeric' })}
          </p>
        ) : (
          <p className={styles.detailHint}>{t(locale, 'cycleTimeHint')}</p>
        )}
      </div>

      <p className={styles.sample}>
        {showPercentiles
          ? t(locale, 'cycleTimeSample', { n: stats!.sampleSize })
          : t(locale, 'cycleTimeThinSample', { n: stats?.sampleSize ?? 0 })}
      </p>
    </div>
  );
}
