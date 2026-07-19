// Pure layout geometry for the PhaseTrack rail — station ordering and dependency-edge
// lane assignment. Extracted from the 960-line PhaseTrack component so the geometry is
// isolated and unit-testable; the component keeps only the stateful rendering.
// Operates on a structural subset of PhaseTrackRow (id + parents + progress).

export interface LayoutRow {
  id: number;
  progress: number;
  parents: { id: number }[];
}

/**
 * Station sequence: a topological order, so every dependency points DOWN the rail —
 * a parent station always sits above its children, and branch-out/branch-in read as
 * local junctions instead of long backward loops. Among the nodes whose parents are
 * all placed, the next critical-chain station wins (the chain stays in chain order
 * and as contiguous as its off-chain feeders allow); ties go by longest-path depth,
 * then id, for a stable layout.
 */
export function stationOrder<T extends LayoutRow>(rows: T[], chainPath: number[]): T[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const chainRank = new Map(chainPath.map((id, i) => [id, i]));

  const depthMemo = new Map<number, number>();
  const depth = (id: number, seen: Set<number>): number => {
    if (depthMemo.has(id)) return depthMemo.get(id)!;
    if (seen.has(id)) return 0; // cycle guard
    seen.add(id);
    const parents = (byId.get(id)?.parents ?? []).filter((p) => byId.has(p.id));
    const d = parents.length === 0 ? 0 : Math.max(...parents.map((p) => depth(p.id, seen))) + 1;
    depthMemo.set(id, d);
    return d;
  };
  rows.forEach((r) => depth(r.id, new Set()));

  // Kahn's algorithm with a priority pick.
  const indeg = new Map<number, number>();
  const children = new Map<number, number[]>();
  rows.forEach((r) => indeg.set(r.id, 0));
  rows.forEach((r) =>
    r.parents.forEach((p) => {
      if (!byId.has(p.id)) return;
      indeg.set(r.id, indeg.get(r.id)! + 1);
      children.set(p.id, [...(children.get(p.id) ?? []), r.id]);
    }),
  );
  const ready = rows.filter((r) => indeg.get(r.id) === 0).map((r) => r.id);
  const better = (a: number, b: number): boolean => {
    const ac = chainRank.has(a), bc = chainRank.has(b);
    if (ac !== bc) return ac; // chain stations preempt
    if (ac) return chainRank.get(a)! < chainRank.get(b)!;
    return (depthMemo.get(a)! - depthMemo.get(b)!) < 0 || (depthMemo.get(a) === depthMemo.get(b) && a < b);
  };
  const out: T[] = [];
  const placed = new Set<number>();
  while (ready.length) {
    let best = 0;
    for (let i = 1; i < ready.length; i++) if (better(ready[i], ready[best])) best = i;
    const id = ready.splice(best, 1)[0];
    placed.add(id);
    out.push(byId.get(id)!);
    for (const c of children.get(id) ?? []) {
      indeg.set(c, indeg.get(c)! - 1);
      if (indeg.get(c) === 0) ready.push(c);
    }
  }
  // Cycle leftovers (invalid graphs the validator flags separately): append stably so
  // every station still renders.
  rows
    .filter((r) => !placed.has(r.id))
    .sort((a, b) => (depthMemo.get(a.id)! - depthMemo.get(b.id)!) || a.id - b.id)
    .forEach((r) => out.push(r));
  return out;
}

export interface Edge {
  from: number;
  to: number;
  fromIdx: number;
  toIdx: number;
  onChain: boolean;
  done: boolean; // the departing phase is complete — the only claim a segment's ink makes
  lane: number; // 0 = mainline; bypasses get 1.. (outer lanes)
}

/**
 * Split dependency edges into mainline segments (adjacent stations) and bypass loops
 * (skipping stations), assigning each bypass an outer lane greedily so overlapping
 * loops never share one (interval coloring).
 */
export function classifyEdges(ordered: LayoutRow[], chainKeys: Set<string>): { edges: Edge[]; laneCount: number } {
  const idx = new Map(ordered.map((r, i) => [r.id, i]));
  const progressById = new Map(ordered.map((r) => [r.id, r.progress]));
  const raw: Omit<Edge, 'lane'>[] = [];
  for (const r of ordered) {
    for (const p of r.parents) {
      if (!idx.has(p.id)) continue;
      const fromIdx = idx.get(p.id)!, toIdx = idx.get(r.id)!;
      raw.push({
        from: p.id, to: r.id,
        fromIdx: Math.min(fromIdx, toIdx), toIdx: Math.max(fromIdx, toIdx),
        onChain: chainKeys.has(`${p.id}-${r.id}`),
        done: (progressById.get(p.id) ?? 0) >= 100,
      });
    }
  }
  const mainline = raw.filter((e) => e.toIdx - e.fromIdx === 1).map((e) => ({ ...e, lane: 0 }));
  const bypasses = raw.filter((e) => e.toIdx - e.fromIdx > 1).sort((a, b) => a.fromIdx - b.fromIdx);
  const laneEnds: number[] = [];
  const placed = bypasses.map((e) => {
    let lane = laneEnds.findIndex((end) => end <= e.fromIdx);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(e.toIdx); } else { laneEnds[lane] = e.toIdx; }
    return { ...e, lane: lane + 1 };
  });
  return { edges: [...mainline, ...placed], laneCount: laneEnds.length };
}
