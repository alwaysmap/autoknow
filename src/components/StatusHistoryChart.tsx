import type { HistoryPoint } from '../lib/history';

// Health maps onto the 0..1 axis: On Track (None) -> Some Risk -> Concerned (Max).
const HEALTH_WORD = ['On Track', 'Some Risk', 'Concerned'];
const healthWord = (v: number) => HEALTH_WORD[Math.max(0, Math.min(2, Math.round(v * 2)))];

// Compact time-series of the two tracked values on a shared 0..1 scale, drawn as
// straight lines between points. Axes carry words only, no numbers:
//   left  = progress  (Not started -> Finished)
//   right = risk/needle (None -> Max)

const NEEDLE = '#c5221f'; // risk (right axis)
const PROGRESS = '#1a6b3c'; // progress (left axis)

export default function StatusHistoryChart({ points }: { points: HistoryPoint[] }) {
  if (points.length === 0) {
    return <p style={{ fontSize: 12, fontStyle: 'italic', color: 'var(--muted, #777)' }}>No status history yet.</p>;
  }

  const W = 380, H = 168, ml = 52, mr = 44, mt = 14, mb = 24;
  const iw = W - ml - mr, ih = H - mt - mb;

  const times = points.map((p) => new Date(p.t).getTime());
  const tmin = Math.min(...times), tmax = Math.max(...times);
  const span = tmax - tmin;
  const px = (t: string) => (span === 0 ? ml + iw / 2 : ml + ((new Date(t).getTime() - tmin) / span) * iw);
  const py = (v: number) => mt + (1 - Math.max(0, Math.min(1, v))) * ih;
  const line = (acc: (p: HistoryPoint) => number) =>
    points.map((p) => `${px(p.t).toFixed(1)},${py(acc(p)).toFixed(1)}`).join(' ');

  const n = points.length;
  const xIdx = n <= 3 ? points.map((_, i) => i) : [0, Math.round((n - 1) / 2), n - 1];
  const fmt = (t: string) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: 440, height: 'auto' }} role="img" aria-label="Needle and progress over time">
      {/* faint reference lines (no numeric labels) */}
      {[0, 0.5, 1].map((v) => (
        <line key={v} x1={ml} y1={py(v)} x2={W - mr} y2={py(v)}
          stroke="var(--border, #e3e0d6)" strokeWidth={v === 0.5 ? 0.5 : 1}
          strokeDasharray={v === 0.5 ? '2 3' : undefined} />
      ))}
      <line x1={ml} y1={mt} x2={ml} y2={H - mb} stroke="var(--border, #e3e0d6)" />
      <line x1={W - mr} y1={mt} x2={W - mr} y2={H - mb} stroke="var(--border, #e3e0d6)" />

      {/* left axis: progress */}
      <text x={ml - 6} y={py(1) + 3} textAnchor="end" fontSize={9} fill={PROGRESS}>Finished</text>
      <text x={ml - 6} y={py(0) + 3} textAnchor="end" fontSize={9} fill={PROGRESS}>Not started</text>
      {/* right axis: risk */}
      <text x={W - mr + 6} y={py(1) + 3} textAnchor="start" fontSize={9} fill={NEEDLE}>Max</text>
      <text x={W - mr + 6} y={py(0) + 3} textAnchor="start" fontSize={9} fill={NEEDLE}>None</text>

      {/* dates */}
      {xIdx.map((i) => (
        <text key={i} x={px(points[i].t)} y={H - mb + 13} textAnchor="middle" fontSize={9} fill="var(--muted, #777)">{fmt(points[i].t)}</text>
      ))}

      {/* straight lines between points */}
      {n > 1 && <polyline points={line((p) => p.progress)} fill="none" stroke={PROGRESS} strokeWidth={1.75} />}
      {n > 1 && <polyline points={line((p) => p.needle)} fill="none" stroke={NEEDLE} strokeWidth={1.75} />}

      {/* points */}
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={px(p.t)} cy={py(p.progress)} r={2.5} fill={PROGRESS}>
            <title>{`${fmt(p.t)} · progress`}</title>
          </circle>
          <circle cx={px(p.t)} cy={py(p.needle)} r={2.5} fill={NEEDLE}>
            <title>{`${fmt(p.t)} · health ${healthWord(p.needle)}`}</title>
          </circle>
        </g>
      ))}
    </svg>
  );
}
