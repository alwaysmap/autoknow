// Critical chain over the phase DAG: the longest path by REMAINING duration, where a
// phase's remaining work is forecastedDuration × (100 − progress) / 100. This is the
// spine of the PhaseGraph visualization (heavier edges, ringed nodes, Constraint tag)
// and an evidence record for the leadership-summary generator. Pure and client-safe —
// no server-only imports; used by both the client rail and lib/summaries on the server.

export interface ChainPhase {
  id: number;
  name: string;
  forecastedDuration: number; // days
  progress: number; // 0..100
  parentIds: number[]; // dependsOn phase ids
}

export interface CriticalChain {
  /** Phase ids along the chain, upstream → downstream. Empty when no work remains. */
  path: number[];
  /** Edge keys `${fromId}-${toId}` along the chain, for edge emphasis. */
  edgeKeys: Set<string>;
  /** Total remaining forecast days along the chain (rounded). */
  remainingDays: number;
  /** The first unfinished phase on the chain — the current constraint. */
  constraintId: number | null;
}

export const remainingDays = (p: Pick<ChainPhase, 'forecastedDuration' | 'progress'>): number =>
  (p.forecastedDuration * (100 - Math.max(0, Math.min(100, p.progress)))) / 100;

export function computeCriticalChain(phases: ChainPhase[]): CriticalChain {
  const empty: CriticalChain = { path: [], edgeKeys: new Set(), remainingDays: 0, constraintId: null };
  if (phases.length === 0) return empty;

  const byId = new Map(phases.map((p) => [p.id, p]));
  const children = new Map<number, number[]>();
  for (const p of phases) {
    for (const parent of p.parentIds) {
      if (!byId.has(parent)) continue;
      children.set(parent, [...(children.get(parent) ?? []), p.id]);
    }
  }

  // Longest remaining-duration path STARTING at each node, memoized. Cycles (invalid
  // data — the actions reject them, but be defensive) contribute nothing.
  const best = new Map<number, { days: number; next: number | null }>();
  const visiting = new Set<number>();
  const solve = (id: number): { days: number; next: number | null } => {
    const memo = best.get(id);
    if (memo) return memo;
    if (visiting.has(id)) return { days: 0, next: null };
    visiting.add(id);
    const own = remainingDays(byId.get(id)!);
    let result: { days: number; next: number | null } = { days: own, next: null };
    for (const child of children.get(id) ?? []) {
      const sub = solve(child);
      if (own + sub.days > result.days) result = { days: own + sub.days, next: child };
    }
    visiting.delete(id);
    best.set(id, result);
    return result;
  };

  let startId: number | null = null;
  let max = 0;
  for (const p of phases) {
    const { days } = solve(p.id);
    if (days > max) {
      max = days;
      startId = p.id;
    }
  }
  if (startId === null || max <= 0) return empty; // everything done — no chain to press on

  const path: number[] = [];
  const edgeKeys = new Set<string>();
  for (let id: number | null = startId; id !== null; ) {
    path.push(id);
    const next: number | null = best.get(id)?.next ?? null;
    if (next !== null) edgeKeys.add(`${id}-${next}`);
    id = next;
  }

  const constraintId = path.find((id) => (byId.get(id)?.progress ?? 0) < 100) ?? null;
  return { path, edgeKeys, remainingDays: Math.round(max), constraintId };
}
