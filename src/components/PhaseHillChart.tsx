'use client';

import ChartLabel from './ChartLabel';
import { layoutHill, type HillStatus } from '../lib/hillLayout';
import { phaseColor } from '../lib/phase';
import { t, statusKey, type StringKey } from '../lib/i18n';
import { useLocale } from './LocaleProvider';

// Task progress for a program's phases: one dot per phase on the hill (uphill
// "figuring it out" -> downhill "making it happen"). Each dot is the phase's own color so
// they stay distinguishable; hover shows a per-phase tooltip. Status is inferred from the
// dot's position — 0 Not Started, 100 Done, between In Progress.
//
// EVERY dot renders, always. Progress is the x axis, so a 15-phase program stacks its
// Done phases on one coordinate and its Not-Started ones on another; `layoutHill` fans
// those ties along y into a shingled stack and hands back a viewBox big enough to hold
// the result. Labels are a separate, LOSSY layer: in-progress phases are named first, a
// stack collapses to its status word, and anything with nowhere left to go loses its
// label but keeps its dot, its tooltip, its focus stop and its deeplink.

export interface PhaseDot {
  id: number;
  name: string;
  progress: number; // 0..100
  status?: string; // ignored for display; kept for callers' convenience
}

/** Fired by dot clicks; PhaseTrack listens and jump-and-flashes the phase row. */
export const JUMP_PHASE_EVENT = 'autoknow:jump-phase';

// Control points of the hill bézier in the base 200-unit-wide space (lib/geometry's
// HILL_PATH). The wide variant stretches x only — an affine map, so the curve stays
// a valid bézier and hillCoordinates just needs its x scaled.
const HILL_CP = [[10, 80], [50, 80], [70, 10], [100, 10], [130, 10], [150, 80], [190, 80]] as const;
const hillPath = (sx: number) => {
  const p = HILL_CP.map(([x, y]) => `${(x * sx).toFixed(1)} ${y}`);
  return `M ${p[0]} C ${p[1]}, ${p[2]}, ${p[3]} C ${p[4]}, ${p[5]}, ${p[6]}`;
};

const STATUS_KEY: Record<HillStatus, StringKey> = {
  notStarted: 'statusNotStarted',
  inProgress: 'statusInProgress',
  done: 'statusDone',
};

export default function PhaseHillChart({ phases, wide = false }: { phases: PhaseDot[]; wide?: boolean }) {
  const locale = useLocale();
  // `wide` stretches the hill 2.1x on x for full-content-width placement: the chart
  // stays a short band instead of a huge dome, and labels get real room.
  const sx = wide ? 2.1 : 1;
  const W = 200 * sx;
  const axisFs = wide ? 7 : 8;
  const axisLabels = { left: t(locale, 'figuringItOut'), right: t(locale, 'makingItHappen') };

  if (phases.length === 0) {
    return <p style={{ fontSize: '0.75rem', fontStyle: 'italic', color: 'var(--muted)' }}>{t(locale, 'noPhasesYet')}</p>;
  }
  const layout = layoutHill(phases, {
    width: W,
    fontSize: 8,
    axisFontSize: axisFs,
    hitRadius: wide ? 8 : 10,
    statusLabel: (s) => t(locale, STATUS_KEY[s]),
    axisLabels,
  });

  const jump = (id: number) => {
    window.dispatchEvent(new CustomEvent(JUMP_PHASE_EVENT, { detail: id }));
  };
  return (
    // `group`, not `img`: an img-role element's subtree is presentational, which would
    // hide fifteen focusable dots — and a dot in a collapsed stack has no visible label,
    // so its accessible name is the only thing that identifies it. (The read-only
    // per-phase gauge in PhaseHillGauge has no interactive children and stays `img`.)
    <svg viewBox={layout.viewBox} style={{ width: '100%', height: 'auto', overflow: 'visible' }} role="group" aria-label={t(locale, 'hillAria')}>
      {/* Instrument style only (revealed by CSS; see globals.css and PhaseHillSvg,
          which carries the same pair). Groove under the curve, quarter-tick
          graticule along the baseline — the same scale the dots are read against.
          Scaled by sx so the wide summary hill and the small per-phase gauges
          stay the same drawing. */}
      <path
        data-inst-only
        d={hillPath(sx)}
        fill="none"
        stroke="var(--fg)"
        strokeOpacity={0.07}
        strokeWidth={9}
        strokeLinecap="round"
      />
      <g data-inst-only stroke="var(--border)" strokeWidth={1} strokeLinecap="round">
        <line x1={10 * sx} y1={84} x2={190 * sx} y2={84} strokeOpacity={0.55} />
        {[10, 55, 100, 145, 190].map((x) => (
          <line key={x} x1={x * sx} y1={84} x2={x * sx} y2={x === 100 ? 78 : 80.5} />
        ))}
      </g>
      <path d={hillPath(sx)} fill="none" stroke="var(--border)" strokeWidth={2.5} strokeLinecap="round" />
      <line x1={100 * sx} y1={10} x2={100 * sx} y2={80} stroke="var(--border)" strokeDasharray="3 3" />
      {/* Labels first, dots on top: where a long name has nowhere to go but across a
          stack, the coins stay whole and the text tucks behind them. */}
      {layout.labels.map((l) => (
        <ChartLabel
          key={l.key}
          x={l.x}
          y={l.y}
          textAnchor="middle"
          fontSize={8}
          fontWeight={l.kind === 'group' ? 500 : 600}
          fill={l.kind === 'group' ? 'var(--muted)' : 'var(--fg)'}
          data-testid={`hill-label-${l.anchorId}`}
        >
          {l.text}
        </ChartLabel>
      ))}
      {layout.dots.map((d) => {
        // Every dot is a deeplink that slides the phase card into view and flashes it.
        const label = `${d.name} — ${t(locale, statusKey(d.progress))}`;
        return (
          <g
            key={d.id}
            onClick={() => jump(d.id)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); jump(d.id); } }}
            tabIndex={0}
            style={{ cursor: 'pointer' }}
            role="link"
            aria-label={label}
            data-testid={`hill-dot-${d.id}`}
          >
            {/* oversized invisible hit area — the visible dot alone is well under a finger */}
            <circle cx={d.x} cy={d.y} r={d.hitR} fill="transparent" />
            <circle cx={d.x} cy={d.y} r={d.r} fill={phaseColor(d.id)} stroke="var(--paper)" strokeWidth={1.6} />
            <title>{label}</title>
          </g>
        );
      })}
      <ChartLabel x={50 * sx} y={99} textAnchor="middle" fontSize={axisFs} fill="var(--muted)">{axisLabels.left}</ChartLabel>
      <ChartLabel x={150 * sx} y={99} textAnchor="middle" fontSize={axisFs} fill="var(--muted)">{axisLabels.right}</ChartLabel>
    </svg>
  );
}
