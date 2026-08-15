'use client';

import ChartLabel from './ChartLabel';
import React, { useMemo, useState } from 'react';
import { baselineToCentreY, centreToBaselineY, dodgeLabels, estimateTextWidth, halfHFor } from '../lib/labelPlacement';
import { t } from '../lib/i18n';
import { useLocale } from './LocaleProvider';
import { dayLabel } from '../lib/dates';
import { useDateLabels } from './DateLabelsProvider';
import Link from 'next/link';
import { phaseHref } from '../lib/phase';
import styles from './CycleTimeScatterPlot.module.css';

// Cycle time as ONE population: every COMPLETED phase is a point, plotted where it landed
// (x) against how long it took (y), with the empirical percentiles as horizontal reference
// lines across the whole chart.
//
// Completed work ONLY, filtered at the data boundary — lib/dashboardData states why, and is
// where that rule is enforced rather than merely observed here.
//
// ONE population and not one row per phase name — lib/dashboardData carries why that
// grouping was invalid. What the row labels were for, WHICH phase a point is, is a hover.
//
// Shape follows dvhthomas/flowmetrics, whose cycle-time chart is per-item points under
// empirical P50/P85/P95 reference lines. Two things borrowed deliberately: the percentiles
// are EMPIRICAL (drawn from completed work, never a model), and they travel with their
// sample size — see `CycleTimeStats.sampleSize` for why that field is not optional.

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
  /**
   * How many FINISHED phases the three figures above were computed from — and NOT optional.
   * These are empirical percentiles, so a P85 over 43 phases and a P85 over 6 are different
   * claims wearing the same label, and the chart is the only thing in a position to say
   * which one the reader is looking at. It rides inside this object rather than beside it
   * so the percentiles cannot be rendered without the number that qualifies them; below
   * `MIN_SAMPLE` they are not drawn at all.
   */
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
  const dateLabels = useDateLabels();
  // `active`, not `selected`: a hover overwrites it and leaving clears it, so it tracks what
  // the reader is pointing at rather than a choice they made. Released on leave/blur so the
  // readout is never stranded describing a point nobody is looking at any more.
  const [active, setActive] = useState<CycleTimeData | null>(null);

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
  const xScale = (ms: number) =>
    marginLeft + ((ms - timeRange.min) / (timeRange.max - timeRange.min)) * innerWidth;
  const yScale = (days: number) => marginTop + innerHeight - (days / maxDays) * innerHeight;

  const yTicks: number[] = [];
  for (let d = 0; d <= maxDays; d += Math.max(10, Math.round(maxDays / 5))) yTicks.push(d);

  // Four evenly spaced dates across the window — the axis is a time RANGE, so the ticks are
  // positions in it rather than one per datum.
  const xTicks = [0, 1, 2, 3].map((i) => timeRange.min + ((timeRange.max - timeRange.min) * i) / 3);

  const sampleSize = stats?.sampleSize ?? 0;
  const showPercentiles = stats !== null && sampleSize >= MIN_SAMPLE;
  const rawBands = showPercentiles
    ? [
      { key: 'p50', days: stats.p50, label: 'P50' },
      { key: 'p85', days: stats.p85, label: 'P85' },
      { key: 'p95', days: stats.p95, label: 'P95' },
    ]
    : [];

  // No ink passed, and that is safe rather than an omission (cf. autoknow-fs3): the captions
  // sit at x >= width - marginRight + 6, past where every reference line stops, so nothing
  // inside the plot can overlap them in x.
  //
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
            <line x1={xScale(ms)} y1={height - marginBottom} x2={xScale(ms)} y2={height - marginBottom + 4} className={styles.axisLine} />
            <ChartLabel x={xScale(ms)} y={height - marginBottom + 18} textAnchor="middle" className={styles.axisLabel}>
              {dayLabel(new Date(ms), locale, dateLabels)}
            </ChartLabel>
          </g>
        ))}

        {/* Horizontal and full-width: they describe the whole population, not any one point. */}
        {bands.map((b) => (
          <g key={b.key}>
            <line data-testid={`cycle-line-${b.key}`} x1={marginLeft} y1={yScale(b.days)} x2={width - marginRight} y2={yScale(b.days)} className={styles.percentileLine} />
            <ChartLabel data-testid={`cycle-${b.key}`} x={width - marginRight + 6} y={b.captionY} className={styles.percentileLabel}>
              {b.label} · {t(locale, 'daysShort', { n: b.days })}
            </ChartLabel>
          </g>
        ))}

        {data.map((d) => (
          <circle
            key={d.phaseId}
            cx={xScale(new Date(d.finishedAt).getTime())}
            cy={yScale(d.cycleTimeDays)}
            r={5}
            className={`${styles.point} ${active?.phaseId === d.phaseId ? styles.pointActive : ''}`}
            // Focusable and described, but NOT `role="button"` and no key handler: pointing
            // the readout at a point is not an activation, and promising one that does
            // nothing is worse than promising none. Going TO the phase is the readout's own
            // link, which is a real link rather than a keystroke this would have to fake.
            tabIndex={0}
            aria-label={t(locale, 'cyclePointTitle', { name: d.phaseName, n: d.cycleTimeDays })}
            onClick={() => setActive(d)}
            onMouseEnter={() => setActive(d)}
            onMouseLeave={() => setActive(null)}
            onFocus={() => setActive(d)}
            onBlur={() => setActive(null)}
          >
            {/* Kept alongside the readout, not instead of it: this is the fallback for a
                pointer that dwells without the panel in view, and it travels with the SVG
                if the markup is ever rendered outside this component. */}
            <title>{t(locale, 'cyclePointTitle', { name: d.phaseName, n: d.cycleTimeDays })}</title>
          </circle>
        ))}
      </svg>

      {/* BELOW the chart, not floating over it: a panel that follows the pointer covers the
          neighbouring points a reader is trying to compare against. */}
      {/* No `aria-live`: every point already carries the same sentence as its accessible
          name, so announcing the panel too would say it twice per focus move — and on a
          mouse it would fire for every point the pointer crossed. */}
      <div className={styles.detail} data-testid="cycle-readout">
        {active ? (
          <p className={styles.detailLine}>
            <Link href={phaseHref(active.projectId, active.phaseId)} className={styles.detailLink}>
              {active.phaseName}
            </Link>
            {' · '}{active.programName}
            {' · '}{t(locale, 'daysShort', { n: active.cycleTimeDays })}
            {' · '}{dayLabel(active.finishedAt, locale, dateLabels, { year: true })}
          </p>
        ) : (
          <p className={styles.detailHint}>{t(locale, 'cycleTimeHint')}</p>
        )}
      </div>

      <p className={styles.sample}>
        {t(locale, showPercentiles ? 'cycleTimeSample' : 'cycleTimeThinSample', { n: sampleSize })}
      </p>
    </div>
  );
}
