import { HILL_PATH, hillCoordinates } from '../lib/geometry';

// Task progress for a program's phases: one dot per phase on the hill (uphill
// "figuring it out" -> downhill "making it happen"), colored by phase status.

export interface PhaseDot {
  id: number;
  name: string;
  progress: number; // 0..100
  status: string;
}

const STATUS_COLOR: Record<string, string> = {
  'Not Started': '#9aa0a6',
  'Active WIP': '#1a4d8f',
  'Finished': '#1a7d3c',
  'Skipped': '#b0a99a',
};

export default function PhaseHillChart({ phases }: { phases: PhaseDot[] }) {
  if (phases.length === 0) {
    return <p style={{ fontSize: 12, fontStyle: 'italic', color: 'var(--muted, #888)' }}>No phases yet.</p>;
  }
  return (
    <svg viewBox="0 0 200 104" style={{ width: '100%', maxWidth: 300, height: 'auto' }} role="img" aria-label="Phase progress on the hill">
      <path d={HILL_PATH} fill="none" stroke="var(--border, #d9d5c8)" strokeWidth={2.5} strokeLinecap="round" />
      <line x1={100} y1={10} x2={100} y2={80} stroke="var(--border, #e3e0d6)" strokeDasharray="3 3" />
      {phases.map((ph) => {
        const { x, y } = hillCoordinates(ph.progress);
        return (
          <circle key={ph.id} cx={x} cy={y} r={5} fill={STATUS_COLOR[ph.status] || '#9aa0a6'} stroke="#fff" strokeWidth={1.5}>
            <title>{`${ph.name}: ${ph.status}`}</title>
          </circle>
        );
      })}
      <text x={50} y={99} textAnchor="middle" fontSize={8} fill="var(--muted, #888)">Figuring it out</text>
      <text x={150} y={99} textAnchor="middle" fontSize={8} fill="var(--muted, #888)">Making it happen</text>
    </svg>
  );
}
