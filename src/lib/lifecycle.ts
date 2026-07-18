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

