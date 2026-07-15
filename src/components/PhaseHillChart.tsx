'use client';

import { HILL_PATH, hillCoordinates } from '../lib/geometry';
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

export default function PhaseHillChart({ phases }: { phases: PhaseDot[] }) {
  const locale = useLocale();
  if (phases.length === 0) {
    return <p style={{ fontSize: 12, fontStyle: 'italic', color: 'var(--muted, #888)' }}>{t(locale, 'noPhasesYet')}</p>;
  }
  return (
    <svg viewBox="0 0 200 104" style={{ width: '100%', maxWidth: 300, height: 'auto' }} role="img" aria-label={t(locale, 'hillAria')}>
      <path d={HILL_PATH} fill="none" stroke="var(--border, #d9d5c8)" strokeWidth={2.5} strokeLinecap="round" />
      <line x1={100} y1={10} x2={100} y2={80} stroke="var(--border, #e3e0d6)" strokeDasharray="3 3" />
      {phases.map((ph) => {
        const { x, y } = hillCoordinates(ph.progress);
        return (
          <circle key={ph.id} cx={x} cy={y} r={5.5} fill={phaseColor(ph.id)} stroke="#fff" strokeWidth={1.6}>
            <title>{`${ph.name} — ${t(locale, statusKey(ph.progress))}`}</title>
          </circle>
        );
      })}
      <text x={50} y={99} textAnchor="middle" fontSize={8} fill="var(--muted, #888)">{t(locale, 'figuringItOut')}</text>
      <text x={150} y={99} textAnchor="middle" fontSize={8} fill="var(--muted, #888)">{t(locale, 'makingItHappen')}</text>
    </svg>
  );
}
