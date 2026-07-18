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
 * Station sequence: the critical chain first, in chain order — the main line stays one
 * contiguous solid track. Remaining phases follow in topological order (longest-path
 * depth, then id) and connect via bypass loops from their real parents.
 */
export function stationOrder<T extends LayoutRow>(rows: T[], chainPath: number[]): T[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const chainSet = new Set(chainPath);
  const chainRows = chainPath.map((id) => byId.get(id)).filter((r): r is T => !!r);
  const rest = rows.filter((r) => !chainSet.has(r.id));
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
  const restSorted = [...rest].sort((a, b) => (depthMemo.get(a.id)! - depthMemo.get(b.id)!) || a.id - b.id);
  return [...chainRows, ...restSorted];
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
