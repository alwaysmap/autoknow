'use client';

import ChartLabel from './ChartLabel';
import React, { useMemo } from 'react';
import { baselineToCentreY, centreToBaselineY, dodgeLabels, estimateTextWidth, halfHFor } from '../lib/labelPlacement';
import { t } from '../lib/i18n';
import { useLocale } from './LocaleProvider';
import styles from './CycleTimeScatterPlot.module.css';

// Mirrors `.percentileLabel`'s `font-size: 0.625rem` — the box estimate has to match the
// type it is reserving room for, and the cascade is not readable from here.
const PERCENTILE_FS = 10;
/** Baseline offset of a percentile caption above its whisker (unchanged; the whisker
 *  spans ±20 around the row). */
const PERCENTILE_DY = -22;

export interface CycleTimeData {
  phaseId: number;
  phaseName: string;
  cycleTimeDays: number;
  isFinished: boolean;
}

export interface CycleTimeStats {
  p50: number;
  p85: number;
  p95: number;
}

interface CycleTimeScatterPlotProps {
  data: CycleTimeData[];
  stats: Record<string, CycleTimeStats>;
}

export default function CycleTimeScatterPlot({ data, stats }: CycleTimeScatterPlotProps) {
  const locale = useLocale();
  // Extract unique phase names
  const phaseNames = useMemo(() => {
    const names = Array.from(new Set(data.map((d) => d.phaseName)));
    // Sort by name or some logical order
    return names.sort();
  }, [data]);

  const maxDays = useMemo(() => {
    const max = Math.max(...data.map(d => d.cycleTimeDays), 10);
    return Math.ceil(max / 10) * 10;
  }, [data]);

  const width = 800;
  const height = Math.max(400, phaseNames.length * 60 + 100);
  const marginLeft = 180;
  const marginRight = 50;
  const marginTop = 40;
  const marginBottom = 40;

  const innerWidth = width - marginLeft - marginRight;
  const innerHeight = height - marginTop - marginBottom;

  const xScale = (days: number) => marginLeft + (days / maxDays) * innerWidth;
  const yScale = (index: number) => marginTop + (index + 0.5) * (innerHeight / Math.max(1, phaseNames.length));

  if (data.length === 0) {
    return <div className={styles.container} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: 'var(--muted)', fontSize: '0.8125rem' }}>{t(locale, 'notEnoughCycleTime')}</p>
    </div>;
  }

  // Draw X axis ticks
  const xTicks = [];
  for (let i = 0; i <= maxDays; i += Math.max(10, Math.round(maxDays / 10))) {
    xTicks.push(i);
  }

  // P50 and P85 both want the same baseline above their own whisker, so a TIGHT
  // distribution — p50 ≈ p85, which is the HEALTHY case and therefore the one a reader
  // most wants to trust — printed them on top of each other. Both are distinct facts that
  // cannot be inferred from the other, so they are NUDGED apart in y (dodgeLabels) rather
  // than one being hidden; the whiskers stay exactly where the data puts them. Bounds are
  // the channel above this row only, so a dodged caption can never wander into its
  // neighbour: the row pitch is ≥ 60 (height grows with the phase count) and the channel
  // is 26 tall.
  const percentileYs = new Map<string, { p50: number; p85: number }>();
  for (const [i, name] of phaseNames.entries()) {
    const s = stats[name];
    if (!s) continue;
    const rowY = yScale(i);
    // Placed in CENTRE space, which is the only space labelPlacement reasons in — convert
    // in, convert out. Doing it here rather than compensating in the bounds means a future
    // third label, or a `fixed` obstacle passed per the PlacedLabel doc, is automatically
    // in the same space instead of ~3px off with no failing test.
    const baselineY = rowY + PERCENTILE_DY;
    const centreY = baselineToCentreY(baselineY, PERCENTILE_FS);
    const box = (days: number, text: string) => ({
      x: xScale(days),
      y: centreY,
      halfW: estimateTextWidth(text, PERCENTILE_FS) / 2,
      halfH: halfHFor(PERCENTILE_FS),
      priority: 1,
    });
    // The travel window, converted through the SAME transform as the boxes so the whole
    // system translates together. These numbers are LOAD-BEARING: dodgeLabels moves only
    // the LATER label, so the window must hold a full `halfH + halfH` = 12px on ONE side
    // of the first caption, or the pair silently stays overlapped. A symmetric window
    // fails for that reason — the asymmetry is the mechanism, not an accident.
    //
    // −20 rather than the −18 that "works": 18 clears by EXACTLY 12.0, a knife-edge with
    // no margin, where the collision predicate is a strict `<`. Any float dust (this
    // window is now converted, so there is some) or a 1px change to PERCENTILE_FS lands
    // on the wrong side of it and both captions silently print on top of each other.
    // 20 buys 2px of slack and still clears the row above, whose own captions sit ~40px
    // further up.
    //
    // Asymmetric downward because two 12px captions do not both fit in the 20px gap
    // between adjacent whiskers, so the lower one may sit over the top of its OWN
    // whisker — a thin rule it stays legible against, and the lesser evil against hiding
    // a percentile outright.
    const [p50, p85] = dodgeLabels([], [box(s.p50, 'P50'), box(s.p85, 'P85')], {
      top: baselineToCentreY(baselineY - 20, PERCENTILE_FS),
      bottom: baselineToCentreY(baselineY + 8, PERCENTILE_FS),
    });
    // Rounded on the way out, like the path coords in CapacityChart. Not cosmetic: the
    // centre↔baseline round-trip leaves float dust (…12.000000000000007), and a caption
    // pair separated by exactly halfH+halfH is decided by a strict `<`. Dust on the wrong
    // side of that reports a collision — or worse, hides one — for two labels that are
    // pixel-identical. 2dp is far finer than a pixel and makes the comparison stable.
    const round2 = (v: number) => Math.round(v * 100) / 100;
    percentileYs.set(name, {
      p50: round2(centreToBaselineY(p50, PERCENTILE_FS)),
      p85: round2(centreToBaselineY(p85, PERCENTILE_FS)),
    });
  }

  return (
    <div className={styles.container}>
      <svg className={styles.svg} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
        {/* Axes */}
        <line x1={marginLeft} y1={marginTop} x2={marginLeft} y2={height - marginBottom} className={styles.axisLine} />
        <line x1={marginLeft} y1={height - marginBottom} x2={width - marginRight} y2={height - marginBottom} className={styles.axisLine} />

        {/* X Axis Labels */}
        {xTicks.map(tick => (
          <g key={tick}>
            <line x1={xScale(tick)} y1={height - marginBottom} x2={xScale(tick)} y2={height - marginBottom + 5} className={styles.axisLine} />
            <ChartLabel x={xScale(tick)} y={height - marginBottom + 20} textAnchor="middle" className={styles.axisLabel}>{t(locale, 'daysShort', { n: tick })}</ChartLabel>
          </g>
        ))}

        {/* Y Axis Labels (Phases) */}
        {phaseNames.map((name, i) => (
          <ChartLabel key={name} x={marginLeft - 15} y={yScale(i)} textAnchor="end" dominantBaseline="middle" className={styles.axisLabel}>
            {name}
          </ChartLabel>
        ))}

        {/* Grid lines (horizontal per phase) */}
        {phaseNames.map((name, i) => (
          <line
            key={`grid-${i}`}
            x1={marginLeft}
            y1={yScale(i)}
            x2={width - marginRight}
            y2={yScale(i)}
            stroke="var(--border)"
            strokeDasharray="2 4"
            opacity="0.5"
          />
        ))}

        {/* Global or Local Percentiles */}
        {phaseNames.map((name, i) => {
          const phaseStats = stats[name];
          const labelY = percentileYs.get(name);
          if (!phaseStats || !labelY) return null;
          const y = yScale(i);
          return (
            <g key={`stats-${name}`}>
              {/* P50 Line */}
              <line x1={xScale(phaseStats.p50)} y1={y - 20} x2={xScale(phaseStats.p50)} y2={y + 20} className={styles.percentileLine} />
              <ChartLabel data-testid={`cycle-p50-${i}`} x={xScale(phaseStats.p50)} y={labelY.p50} textAnchor="middle" className={styles.percentileLabel}>P50</ChartLabel>

              {/* P85 Line */}
              <line x1={xScale(phaseStats.p85)} y1={y - 20} x2={xScale(phaseStats.p85)} y2={y + 20} className={styles.percentileLine} stroke="var(--t-500)" />
              <ChartLabel data-testid={`cycle-p85-${i}`} x={xScale(phaseStats.p85)} y={labelY.p85} textAnchor="middle" className={styles.percentileLabel} fill="var(--t-600)">P85</ChartLabel>
            </g>
          );
        })}

        {/* Data Points */}
        {data.map((d, i) => {
          const pIndex = phaseNames.indexOf(d.phaseName);
          if (pIndex === -1) return null;
          // Deterministic vertical jitter seeded by the data point's OWN identity —
          // not its array index, which would move the point when upstream ordering
          // changes despite the "stable across re-renders" intent.
          const seed = (d.phaseId * 31 + Math.round(d.cycleTimeDays) * 17) % 1000;
          const jitter = (seed / 1000 - 0.5) * 15;
          const cx = xScale(d.cycleTimeDays);
          const cy = yScale(pIndex) + jitter;
          return (
            <circle
              key={`${d.phaseId}-${i}`}
              cx={cx}
              cy={cy}
              r={4}
              className={d.isFinished ? styles.point : styles.pointActive}
            >
              <title>{t(locale, 'cyclePointTitle', { name: d.phaseName, n: d.cycleTimeDays, status: d.isFinished ? t(locale, 'finishedParen') : t(locale, 'activeParen') })}</title>
            </circle>
          );
        })}
      </svg>
    </div>
  );
}
