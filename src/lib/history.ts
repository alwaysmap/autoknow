import 'server-only';
import { prisma } from './db';

// The recorded status history of anything that logs it — a project, a phase, or a
// partner relationship — read back for the DETAIL popups that are now the only
// place this history is displayed (the standalone /history pages were retired:
// programs and partners 2026-07-20, phases 2026-07-21).

export type HistoryType = 'project' | 'phase' | 'partner';

// One recorded needle change, with full fidelity (health string + 0..100 progress + the
// previous state for the ghost marker + the markdown note), for the list/history cards.
export interface NeedleChange {
  timestamp: string;
  progress: number; // 0..100
  health: string | null;
  previousProgress: number | null;
  previousHealth: string | null;
  /** Partner scope only: the stored 1..5 relationship score (lib/relationship). */
  score?: number | null;
  previousScore?: number | null;
  notes: string | null;
  /** Who filed it — the handle the action stamped (lib/session). */
  source: string | null;
}

type RawState = { theNeedle: string | null; hillChartProgress: number | null; relationshipScore?: number | null; notes: string | null; source?: string | null; timestamp: Date };

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
      source: s.source ?? null,
    }))
    .reverse();

export async function getNeedleHistory(
  type: HistoryType,
  id: number,
): Promise<{ title: string; changes: NeedleChange[] } | null> {
  const select = { theNeedle: true, hillChartProgress: true, notes: true, source: true, timestamp: true } as const;
  if (type === 'project') {
    const p = await prisma.project.findUnique({ where: { id }, select: { name: true, states: { orderBy: { timestamp: 'asc' }, select } } });
    return p ? { title: p.name, changes: toChanges(p.states) } : null;
  }
  if (type === 'phase') {
    const ph = await prisma.phase.findUnique({ where: { id }, select: { name: true, project: { select: { name: true } }, states: { orderBy: { timestamp: 'asc' }, select } } });
    return ph ? { title: `${ph.project.name} — ${ph.name}`, changes: toChanges(ph.states) } : null;
  }
  // Partners also carry the 1..5 relationship score per state.
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
