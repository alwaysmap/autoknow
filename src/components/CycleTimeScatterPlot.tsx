'use client';

import React, { useMemo } from 'react';
import { t } from '../lib/i18n';
import { useLocale } from './LocaleProvider';
import styles from './CycleTimeScatterPlot.module.css';

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
            <text x={xScale(tick)} y={height - marginBottom + 20} textAnchor="middle" className={styles.axisLabel}>{t(locale, 'daysShort', { n: tick })}</text>
          </g>
        ))}

        {/* Y Axis Labels (Phases) */}
        {phaseNames.map((name, i) => (
          <text key={name} x={marginLeft - 15} y={yScale(i)} textAnchor="end" dominantBaseline="middle" className={styles.axisLabel}>
            {name}
          </text>
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
          if (!phaseStats) return null;
          const y = yScale(i);
          return (
            <g key={`stats-${name}`}>
              {/* P50 Line */}
              <line x1={xScale(phaseStats.p50)} y1={y - 20} x2={xScale(phaseStats.p50)} y2={y + 20} className={styles.percentileLine} />
              <text x={xScale(phaseStats.p50)} y={y - 22} textAnchor="middle" className={styles.percentileLabel}>P50</text>
              
              {/* P85 Line */}
              <line x1={xScale(phaseStats.p85)} y1={y - 20} x2={xScale(phaseStats.p85)} y2={y + 20} className={styles.percentileLine} stroke="var(--t-500)" />
              <text x={xScale(phaseStats.p85)} y={y - 22} textAnchor="middle" className={styles.percentileLabel} fill="var(--t-600)">P85</text>
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
