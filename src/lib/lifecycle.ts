// THE data-access boundary for program visibility (decided 2026-07-18):
//
//   LISTS (tables, pickers, feeds)   → archived programs are HIDDEN.
//   CHARTS / AGGREGATES              → archived data is NEVER hidden — history
//                                      stays true. Only `cancelled` drops out of
//                                      forward-looking capacity, because those
//                                      units will not ship.
//
// Lifecycle (active | complete | cancelled) is an explicit FACT someone sets in
// the UI; isArchived is orthogonal VISIBILITY. Every list predicate and chart
// query goes through these helpers so the rule can't drift per call site.
// Client-safe: pure functions only.

export type ProgramLifecycle = 'active' | 'complete' | 'cancelled';

export const PROGRAM_LIFECYCLES: ProgramLifecycle[] = ['active', 'complete', 'cancelled'];

export function isProgramLifecycle(x: unknown): x is ProgramLifecycle {
  return x === 'active' || x === 'complete' || x === 'cancelled';
}

/** Display status, canonical EN values (localize via statusKeyOf). Precedence:
 *  archived (visibility) > cancelled > complete (explicit OR progress-done) > active. */
export type ProgramStatus = 'Active' | 'Done' | 'Cancelled' | 'Archived';

export function deriveProgramStatus(p: {
  isArchived: boolean;
  lifecycle?: string | null;
  hillChartProgress: number;
}): ProgramStatus {
  if (p.isArchived) return 'Archived';
  if (p.lifecycle === 'cancelled') return 'Cancelled';
  if (p.lifecycle === 'complete' || p.hillChartProgress >= 100) return 'Done';
  return 'Active';
}

/** Lists hide archived programs — nothing else. */
export function visibleInLists(p: { isArchived: boolean }): boolean {
  return !p.isArchived;
}

/** Charts keep archived data; only cancelled programs stop counting toward
 *  forward-looking capacity. */
export function countsTowardCapacity(p: { lifecycle?: string | null }): boolean {
  return p.lifecycle !== 'cancelled';
}

/** Prisma `where` fragment for list queries — the one place the rule is spelled
 *  for the database. Chart queries must NOT apply this. */
export const LIST_WHERE = { isArchived: false } as const;
