'use client';

import { useState, useMemo } from 'react';
import { t } from '../lib/i18n';
import { useLocale } from './LocaleProvider';
import styles from './EcosystemSopChart.module.css';

interface Project {
  id: number;
  name: string;
  isArchived: boolean;
  theNeedle: string;
  hillChartProgress: number;
  sopDate: string | null;
  volumeFirstYear: number;
  partner: {
    name: string;
  };
}

interface EcosystemSopChartProps {
  projects: Project[];
}

export default function EcosystemSopChart({ projects }: EcosystemSopChartProps) {
  const locale = useLocale();
  const [filterMode, setFilterMode] = useState<'all' | 'flight'>('all');
  const [hoveredProject, setHoveredProject] = useState<Project | null>(null);

  // Filter projects based on selection
  const chartData = useMemo(() => {
    // Filter projects that have valid SOP dates
    let filtered = projects.filter((p) => p.sopDate !== null && !p.isArchived);

    if (filterMode === 'flight') {
      filtered = filtered.filter((p) => p.hillChartProgress < 100);
    }

    // Sort chronologically by SOP Date
    return filtered.sort((a, b) => {
      return new Date(a.sopDate!).getTime() - new Date(b.sopDate!).getTime();
    });
  }, [projects, filterMode]);

  // Compute metrics for chart coordinate mapping
  const chartMetrics = useMemo(() => {
    if (chartData.length === 0) return null;

    const times = chartData.map((p) => new Date(p.sopDate!).getTime());
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    const timeSpan = maxTime - minTime || 1;

    const volumes = chartData.map((p) => p.volumeFirstYear);
    const maxVolume = Math.max(...volumes, 1);

    // Compute cumulative running totals
    let runningTotal = 0;
    const cumulativeData = chartData.map((p) => {
      runningTotal += p.volumeFirstYear;
      return runningTotal;
    });

    const grandTotal = runningTotal || 1;

    return {
      minTime,
      maxTime,
      timeSpan,
      maxVolume,
      grandTotal,
      cumulativeData,
    };
  }, [chartData]);

  if (chartData.length === 0) {
    return (
      <div className={styles.chartContainer}>
        <div className={styles.chartHeader}>
          <h3 className={styles.chartTitle}>{t(locale, 'sopChartTitle')}</h3>
        </div>
        <div className={styles.emptyState}>
          {t(locale, 'sopChartEmpty')}
        </div>
      </div>
    );
  }

  const { minTime, timeSpan, maxVolume, grandTotal, cumulativeData } = chartMetrics!;

  // Render SVG properties
  const svgWidth = 800;
  const svgHeight = 260;
  const paddingLeft = 65;
  const paddingRight = 75;
  const paddingTop = 30;
  const paddingBottom = 40;

  const plotWidth = svgWidth - paddingLeft - paddingRight;
  const plotHeight = svgHeight - paddingTop - paddingBottom;

  // Helper coordinate mappers
  const getX = (dateStr: string) => {
    const t = new Date(dateStr).getTime();
    return paddingLeft + ((t - minTime) / timeSpan) * plotWidth;
  };

  const getYVolume = (vol: number) => {
    return svgHeight - paddingBottom - (vol / maxVolume) * (plotHeight * 0.7);
  };

  const getYCumulative = (cumVol: number) => {
    return svgHeight - paddingBottom - (cumVol / grandTotal) * plotHeight;
  };

  // Generate X-Axis Ticks (4 points along timeSpan)
  const xTicks = Array.from({ length: 4 }).map((_, idx) => {
    const t = minTime + (timeSpan * idx) / 3;
    const date = new Date(t);
    return {
      x: paddingLeft + (idx / 3) * plotWidth,
      label: date.toLocaleDateString(locale, { month: 'short', year: '2-digit' }),
    };
  });

  // Generate Y-Axis Ticks
  const yTicksVolume = Array.from({ length: 4 }).map((_, idx) => {
    const vol = (maxVolume * idx) / 3;
    return {
      y: svgHeight - paddingBottom - (idx / 3) * (plotHeight * 0.7),
      label: vol >= 1000 ? `${(vol / 1000).toFixed(0)}k` : `${vol.toFixed(0)}`,
    };
  });

  const yTicksCumulative = Array.from({ length: 4 }).map((_, idx) => {
    const vol = (grandTotal * idx) / 3;
    return {
      y: svgHeight - paddingBottom - (idx / 3) * plotHeight,
      label: vol >= 1000000 ? `${(vol / 1000000).toFixed(1)}M` : vol >= 1000 ? `${(vol / 1000).toFixed(0)}k` : `${vol.toFixed(0)}`,
    };
  });

  // Construct path string for cumulative line chart
  let cumulativePathStr = '';
  chartData.forEach((p, idx) => {
    const x = getX(p.sopDate!);
    const y = getYCumulative(cumulativeData[idx]);
    if (idx === 0) {
      cumulativePathStr += `M ${x} ${y}`;
    } else {
      cumulativePathStr += ` L ${x} ${y}`;
    }
  });

  return (
    <div className={styles.chartContainer}>
      <div className={styles.chartHeader}>
        <div>
          <h3 className={styles.chartTitle}>{t(locale, 'sopChartTitle')}</h3>
          <div className={styles.chartSub}>
            {t(locale, 'sopChartSub')}
          </div>
        </div>

        <div className={styles.chartControls}>
          <button
            onClick={() => setFilterMode('all')}
            data-active={filterMode === 'all'}
            className={styles.filterBtn}
          >
            {t(locale, 'allSops')}
          </button>
          <button
            onClick={() => setFilterMode('flight')}
            data-active={filterMode === 'flight'}
            className={styles.filterBtn}
          >
            {t(locale, 'inFlightOnly')}
          </button>
        </div>
      </div>

      <div className={styles.svgWrapper}>
        <svg className={styles.svg} viewBox={`0 0 ${svgWidth} ${svgHeight}`}>
          {/* Grid Lines */}
          {yTicksVolume.map((tick, idx) => (
            <line
              key={`grid-${idx}`}
              x1={paddingLeft}
              y1={tick.y}
              x2={svgWidth - paddingRight}
              y2={tick.y}
              className={styles.gridLine}
            />
          ))}

          {/* Left Y Axis (Individual Volume) */}
          <line
            x1={paddingLeft}
            y1={paddingTop}
            x2={paddingLeft}
            y2={svgHeight - paddingBottom}
            className={styles.axisLine}
          />
          {yTicksVolume.map((tick, idx) => (
            <text key={`ly-${idx}`} x={paddingLeft - 8} y={tick.y + 4} textAnchor="end" className={styles.axisText}>
              {tick.label}
            </text>
          ))}
          <text
            x={15}
            y={paddingTop + 10}
            transform={`rotate(-90, 15, ${paddingTop + 10})`}
            className={styles.axisText}
            style={{ fontWeight: 700 }}
          >
            {t(locale, 'unitsPerYearAxis')}
          </text>

          {/* Right Y Axis (Cumulative Industry Volume) */}
          <line
            x1={svgWidth - paddingRight}
            y1={paddingTop}
            x2={svgWidth - paddingRight}
            y2={svgHeight - paddingBottom}
            className={styles.axisLine}
          />
          {yTicksCumulative.map((tick, idx) => (
            <text key={`ry-${idx}`} x={svgWidth - paddingRight + 8} y={tick.y + 4} textAnchor="start" className={styles.axisText}>
              {tick.label}
            </text>
          ))}
          <text
            x={svgWidth - 15}
            y={paddingTop + 10}
            transform={`rotate(90, ${svgWidth - 15}, ${paddingTop + 10})`}
            className={styles.axisText}
            style={{ fontWeight: 700 }}
            textAnchor="end"
          >
            {t(locale, 'cumVolumeAxis')}
          </text>

          {/* X Axis */}
          <line
            x1={paddingLeft}
            y1={svgHeight - paddingBottom}
            x2={svgWidth - paddingRight}
            y2={svgHeight - paddingBottom}
            className={styles.axisLine}
          />
          {xTicks.map((tick, idx) => (
            <g key={`x-${idx}`}>
              <line
                x1={tick.x}
                y1={svgHeight - paddingBottom}
                x2={tick.x}
                y2={svgHeight - paddingBottom + 5}
                className={styles.axisLine}
              />
              <text x={tick.x} y={svgHeight - paddingBottom + 18} textAnchor="middle" className={styles.axisText}>
                {tick.label}
              </text>
            </g>
          ))}

          {/* Individual Program Bars */}
          {chartData.map((p, idx) => {
            const x = getX(p.sopDate!);
            const y = getYVolume(p.volumeFirstYear);
            const height = svgHeight - paddingBottom - y;
            const barWidth = 14;

            let status = 'flight';
            if (p.hillChartProgress === 100) status = 'finished';
            else if (p.theNeedle === 'Critical' || p.theNeedle === 'High') status = 'critical';

            return (
              <rect
                key={p.id}
                x={x - barWidth / 2}
                y={y}
                width={barWidth}
                height={Math.max(height, 2)}
                data-status={status}
                className={styles.bar}
                onMouseEnter={() => setHoveredProject(p)}
                onMouseLeave={() => setHoveredProject(null)}
                rx="2"
              />
            );
          })}

          {/* Cumulative Industry Line */}
          {chartData.length > 1 && (
            <path d={cumulativePathStr} className={styles.cumulativeLine} />
          )}

          {/* Cumulative Line Dots */}
          {chartData.map((p, idx) => {
            const x = getX(p.sopDate!);
            const y = getYCumulative(cumulativeData[idx]);

            return (
              <circle
                key={`dot-${p.id}`}
                cx={x}
                cy={y}
                r="4.5"
                className={styles.cumulativeDot}
                onMouseEnter={() => setHoveredProject(p)}
                onMouseLeave={() => setHoveredProject(null)}
              />
            );
          })}
        </svg>
      </div>

      {/* Tooltip Box Details */}
      <div className={styles.tooltipBox}>
        {hoveredProject ? (
          <>
            <div>
              <span className={styles.tooltipTitle}>{hoveredProject.partner.name} - {hoveredProject.name}</span>
              <span
                className={`${styles.badge} ${
                  hoveredProject.hillChartProgress === 100
                    ? styles.statusFinished
                    : hoveredProject.theNeedle === 'Critical' || hoveredProject.theNeedle === 'High'
                    ? styles.flowBlocked
                    : styles.flowActive
                }`}
                style={{
                  backgroundColor:
                    hoveredProject.hillChartProgress === 100
                      ? '#e6f4ea'
                      : hoveredProject.theNeedle === 'Critical' || hoveredProject.theNeedle === 'High'
                      ? '#feebe7'
                      : '#e8f0fe',
                  color:
                    hoveredProject.hillChartProgress === 100
                      ? '#137333'
                      : hoveredProject.theNeedle === 'Critical' || hoveredProject.theNeedle === 'High'
                      ? '#c5221f'
                      : 'var(--p-600)',
                }}
              >
                {hoveredProject.hillChartProgress === 100 ? t(locale, 'launched') : t(locale, 'inFlight')}
              </span>
            </div>
            <div className={styles.tooltipMeta}>
              {t(locale, 'targetSop')} <strong>{new Date(hoveredProject.sopDate!).toLocaleDateString(locale)}</strong> {t(locale, 'volSep')} <strong>{t(locale, 'unitsPerYr', { n: hoveredProject.volumeFirstYear.toLocaleString(locale) })}</strong>
            </div>
          </>
        ) : (
          <span className={styles.tooltipMeta}>{t(locale, 'sopHoverHint')}</span>
        )}
      </div>
    </div>
  );
}
