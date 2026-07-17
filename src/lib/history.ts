import 'server-only';
import { prisma } from './db';
import { healthOrder } from './health';

// Time-series of the two tracked values (needle risk + hill-chart progress), both
// normalized to 0..1, for any object that records status over time: a project, a
// phase, or a partner relationship. Feeds StatusHistoryChart.

export type HistoryType = 'project' | 'phase' | 'partner';

export interface HistoryPoint {
  t: string; // ISO timestamp
  needle: number; // 0..1 (risk)
  progress: number; // 0..1 (hill chart)
  label: string | null; // note / status, for tooltip
}

export interface StatusHistory {
  type: HistoryType;
  id: number;
  title: string;
  points: HistoryPoint[];
}

// Health maps onto the 0..1 "risk" axis: On Track -> 0 (None), Some Risk -> 0.5,
// Concerned -> 1 (Max).
const norm = (needle: string | null, progress: number | null): Pick<HistoryPoint, 'needle' | 'progress'> => ({
  needle: healthOrder(needle) / 2,
  progress: Math.max(0, Math.min(1, (progress ?? 0) / 100)),
});

// One recorded needle change, with full fidelity (health string + 0..100 progress + the
// previous state for the ghost marker + the markdown note), for the list/history cards.
export interface NeedleChange {
  timestamp: string;
  progress: number; // 0..100
  health: string | null;
  previousProgress: number | null;
  previousHealth: string | null;
  /** Partner scope only: the stored 1..7 relationship score (lib/relationship). */
  score?: number | null;
  previousScore?: number | null;
  notes: string | null;
}

type RawState = { theNeedle: string | null; hillChartProgress: number | null; relationshipScore?: number | null; notes: string | null; timestamp: Date };

// Turn ascending states into changes ordered most-recent-first, each carrying the prior
// state so the mini gauge can draw the "previous" marker.
const toChanges = (asc: RawState[]): NeedleChange[] =>
  asc
    .map((s, i) => ({
      timestamp: s.timestamp.toISOString(),
      progress: s.hillChartProgress ?? 0,
      health: s.theNeedle,
      previousProgress: i > 0 ? asc[i - 1].hillChartProgress ?? null : null,
      previousHealth: i > 0 ? asc[i - 1].theNeedle : null,
      score: s.relationshipScore ?? null,
      previousScore: i > 0 ? asc[i - 1].relationshipScore ?? null : null,
      notes: s.notes,
    }))
    .reverse();

export async function getNeedleHistory(
  type: HistoryType,
  id: number,
): Promise<{ title: string; changes: NeedleChange[] } | null> {
  const select = { theNeedle: true, hillChartProgress: true, notes: true, timestamp: true } as const;
  if (type === 'project') {
    const p = await prisma.project.findUnique({ where: { id }, select: { name: true, states: { orderBy: { timestamp: 'asc' }, select } } });
    return p ? { title: p.name, changes: toChanges(p.states) } : null;
  }
  if (type === 'phase') {
    const ph = await prisma.phase.findUnique({ where: { id }, select: { name: true, project: { select: { name: true } }, states: { orderBy: { timestamp: 'asc' }, select } } });
    return ph ? { title: `${ph.project.name} — ${ph.name}`, changes: toChanges(ph.states) } : null;
  }
  // Partners also carry the 1..7 relationship score per state.
  const pa = await prisma.partner.findUnique({
    where: { id },
    select: { name: true, states: { orderBy: { timestamp: 'asc' }, select: { ...select, relationshipScore: true } } },
  });
  return pa ? { title: pa.name, changes: toChanges(pa.states) } : null;
}

// One recorded phase hill-chart update: 0..100 progress (status is inferred from it),
// the previous update (for the ghost dot), the markdown note, and the person who made it.
export interface HillChange {
  timestamp: string;
  progress: number; // 0..100
  previousProgress: number | null;
  notes: string | null;
  source: string | null;
}

export async function getHillHistory(phaseId: number): Promise<{ title: string; changes: HillChange[] } | null> {
  const phase = await prisma.phase.findUnique({
    where: { id: phaseId },
    select: {
      name: true,
      project: { select: { name: true } },
      states: {
        orderBy: { timestamp: 'asc' },
        select: { hillChartProgress: true, notes: true, source: true, timestamp: true },
      },
    },
  });
  if (!phase) return null;
  const changes: HillChange[] = phase.states
    .map((s, i) => ({
      timestamp: s.timestamp.toISOString(),
      progress: s.hillChartProgress ?? 0,
      previousProgress: i > 0 ? phase.states[i - 1].hillChartProgress ?? null : null,
      notes: s.notes,
      source: s.source,
    }))
    .reverse();
  return { title: `${phase.project.name} — ${phase.name}`, changes };
}

export async function getStatusHistory(type: HistoryType, id: number): Promise<StatusHistory | null> {
  if (type === 'project') {
    const project = await prisma.project.findUnique({
      where: { id },
      select: {
        name: true,
        states: { orderBy: { timestamp: 'asc' }, select: { theNeedle: true, hillChartProgress: true, notes: true, timestamp: true } },
      },
    });
    if (!project) return null;
    return {
      type, id, title: project.name,
      points: project.states.map((s) => ({ t: s.timestamp.toISOString(), ...norm(s.theNeedle, s.hillChartProgress), label: s.notes })),
    };
  }

  if (type === 'phase') {
    const phase = await prisma.phase.findUnique({
      where: { id },
      select: {
        name: true,
        project: { select: { name: true } },
        states: { orderBy: { timestamp: 'asc' }, select: { theNeedle: true, hillChartProgress: true, status: true, notes: true, timestamp: true } },
      },
    });
    if (!phase) return null;
    return {
      type, id, title: `${phase.project.name} — ${phase.name}`,
      points: phase.states.map((s) => ({ t: s.timestamp.toISOString(), ...norm(s.theNeedle, s.hillChartProgress), label: s.status ?? s.notes })),
    };
  }

  const partner = await prisma.partner.findUnique({
    where: { id },
    select: {
      name: true,
      states: { orderBy: { timestamp: 'asc' }, select: { theNeedle: true, hillChartProgress: true, notes: true, timestamp: true } },
    },
  });
  if (!partner) return null;
  return {
    type, id, title: partner.name,
    points: partner.states.map((s) => ({ t: s.timestamp.toISOString(), ...norm(s.theNeedle, s.hillChartProgress), label: s.notes })),
  };
}
