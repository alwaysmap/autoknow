'use client';

import { hillCoordinates } from '../lib/geometry';
import { phaseColor } from '../lib/phase';
import { t, statusKey } from '../lib/i18n';
import { useLocale } from './LocaleProvider';

// Task progress for a program's phases: one dot per phase on the hill (uphill
// "figuring it out" -> downhill "making it happen"). Each dot is the phase's own color so
// they stay distinguishable; hover shows a per-phase tooltip. Status is inferred from the
// dot's position — 0 Not Started, 100 Done, between In Progress.

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

export default function PhaseHillChart({ phases, wide = false }: { phases: PhaseDot[]; wide?: boolean }) {
  const locale = useLocale();
  // `wide` stretches the hill 2.1x on x for full-content-width placement: the chart
  // stays a short band instead of a huge dome, and labels get real room.
  const sx = wide ? 2.1 : 1;
  const W = 200 * sx;
  const fs = wide ? 7 : 8; // dot-label font size (viewBox units)
  const maxChars = wide ? 32 : 14;
  const shorten = (name: string) => (name.length > maxChars ? `${name.slice(0, maxChars - 1)}…` : name);
  // Approximate rendered half-width of a label, for clamping and collision checks.
  const halfW = (name: string) => (Math.min(name.length, maxChars) * fs * 0.55) / 2 + 2;

  if (phases.length === 0) {
    return <p style={{ fontSize: 12, fontStyle: 'italic', color: 'var(--muted, #888)' }}>{t(locale, 'noPhasesYet')}</p>;
  }
  const jump = (id: number) => {
    window.dispatchEvent(new CustomEvent(JUMP_PHASE_EVENT, { detail: id }));
  };
  // Label placement: above its dot by default, below when clipped near the crest —
  // then a greedy left-to-right pass flips any label that would overprint an
  // already-placed one (overlapping in x AND close in y, regardless of side —
  // opposite sides of neighboring dots can land at the same height on the slope).
  // A centered label on a dot near either end of the curve slides inward instead of
  // being cropped by the viewBox (the dot stays honest on the curve). Below-side
  // labels must stay clear of the axis captions at y=99; if both sides are taken
  // (dots at nearly the same position) the label stacks upward instead.
  const sorted = phases
    .map((ph) => {
      const c = hillCoordinates(ph.progress);
      return { ph, x: c.x * sx, y: c.y };
    })
    .sort((a, b) => a.x - b.x);
  const placed: { x: number; y: number; hw: number }[] = [];
  const labelPos = new Map<number, { x: number; y: number }>();
  for (const s of sorted) {
    const hw = halfW(s.ph.name);
    const lx = Math.max(hw + 2, Math.min(W - hw - 2, s.x));
    const labelY = (b: boolean) => (b ? s.y + 14 : s.y - 9);
    const collides = (ly: number) => placed.some((p) => Math.abs(lx - p.x) < hw + p.hw + 3 && Math.abs(ly - p.y) < 11);
    let below = s.y < 22;
    const canBelow = labelY(true) < 90;
    if (collides(labelY(below)) && !collides(labelY(!below)) && (below || canBelow)) below = !below;
    let ly = labelY(below);
    while (collides(ly)) ly -= 11;
    placed.push({ x: lx, y: ly, hw });
    labelPos.set(s.ph.id, { x: lx, y: ly });
  }
  return (
    <svg viewBox={`0 0 ${W} 104`} style={{ width: '100%', height: 'auto', overflow: 'visible' }} role="img" aria-label={t(locale, 'hillAria')}>
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
      <path d={hillPath(sx)} fill="none" stroke="var(--border, #d9d5c8)" strokeWidth={2.5} strokeLinecap="round" />
      <line x1={100 * sx} y1={10} x2={100 * sx} y2={80} stroke="var(--border, #e3e0d6)" strokeDasharray="3 3" />
      {phases.map((ph) => {
        const c = hillCoordinates(ph.progress);
        const x = c.x * sx, y = c.y;
        // Every dot is a deeplink that slides the phase card into view and flashes it.
        const pos = labelPos.get(ph.id) ?? { x, y: y - 9 };
        return (
          <g
            key={ph.id}
            onClick={() => jump(ph.id)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); jump(ph.id); } }}
            tabIndex={0}
            style={{ cursor: 'pointer' }}
            role="link"
            aria-label={ph.name}
            data-testid={`hill-dot-${ph.id}`}
          >
            {/* oversized invisible hit area — the visible dot alone is well under a finger */}
            <circle cx={x} cy={y} r={wide ? 8 : 10} fill="transparent" />
            <circle cx={x} cy={y} r={5.5} fill={phaseColor(ph.id)} stroke="var(--paper)" strokeWidth={1.6} />
            <text
              x={pos.x}
              y={pos.y}
              textAnchor="middle"
              fontSize={fs}
              fontWeight={600}
              fill="var(--fg, #444)"
              stroke="var(--white, #fff)"
              strokeWidth={2.5}
              paintOrder="stroke"
            >
              {shorten(ph.name)}
            </text>
            <title>{`${ph.name} — ${t(locale, statusKey(ph.progress))}`}</title>
          </g>
        );
      })}
      <text x={50 * sx} y={99} textAnchor="middle" fontSize={wide ? 7 : 8} fill="var(--muted, #888)">{t(locale, 'figuringItOut')}</text>
      <text x={150 * sx} y={99} textAnchor="middle" fontSize={wide ? 7 : 8} fill="var(--muted, #888)">{t(locale, 'makingItHappen')}</text>
    </svg>
  );
}
