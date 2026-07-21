// Pure layout + graph math for the PhaseTrack rail: station ordering, dependency-edge
// bundling into laned branch lines, and the focus (ancestors/descendants) subgraph.
// Extracted from the 960-line PhaseTrack component so the geometry is isolated and
// unit-testable; the component keeps only the stateful rendering.
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
  fromIdx: number; // the UPPER station's index (geometry is normalized top→bottom)
  toIdx: number; // the LOWER station's index
  onChain: boolean;
  done: boolean; // the departing phase is complete — the only claim a segment's ink makes
}

/** Every dependency as an edge in station-index space; `chainKeys` inks the chain. */
export function railEdges(ordered: LayoutRow[], chainKeys: Set<string>): Edge[] {
  const idx = new Map(ordered.map((r, i) => [r.id, i]));
  const progressById = new Map(ordered.map((r) => [r.id, r.progress]));
  const out: Edge[] = [];
  for (const r of ordered) {
    for (const p of r.parents) {
      if (!idx.has(p.id)) continue;
      const a = idx.get(p.id)!, b = idx.get(r.id)!;
      out.push({
        from: p.id, to: r.id,
        fromIdx: Math.min(a, b), toIdx: Math.max(a, b),
        onChain: chainKeys.has(`${p.id}-${r.id}`),
        done: (progressById.get(p.id) ?? 0) >= 100,
      });
    }
  }
  return out;
}

/** An edge is a bypass when it skips at least one station. */
export const isBypass = (e: Edge) => e.toIdx - e.fromIdx > 1;

// ---------------------------------------------------------------------------
// Bypass BUNDLING — why the gutter used to fill with parallel tracks
//
// Every station-skipping dependency used to claim its own lane, so a program that
// fans out of one phase and back into one gate (the AAOS template: 6 edges out of
// "BSP & power-on", 7 into "Compliance gates") drew NINE nested rectangles down
// the gutter. Every line was individually correct and the set of them was
// unreadable — you could not answer "what does THIS phase depend on".
//
// Bundling merges dependencies that SHARE AN ENDPOINT onto one branch line: a
// single trunk in one lane, with a short tie back into the main line at every
// phase riding it — exactly how a tube map draws a branch serving several
// stations. It removes no relationship and invents none: a phase is on the branch
// iff it has a tie, and the trunk terminates at the shared endpoint. The Ford Evos
// rail goes from nine lanes to three.
//
// The trunk's ink stays honest by SEGMENT: the piece of trunk between two
// consecutive ties inks solid only when EVERY dependency riding that piece departs
// a completed phase. A mixed segment stays gray — under-claiming, which is the
// safe direction for a state-only signal.
// ---------------------------------------------------------------------------

/** A phase where a bundled branch line touches the main line. */
export interface BundleTie {
  phaseId: number;
  idx: number;
  /** the bundled dependencies terminating here — 1 for a partner, all of them at the hub */
  edges: Edge[];
  isHub: boolean;
  done: boolean;
  onChain: boolean;
}

/** The stretch of trunk between two consecutive ties. */
export interface TrunkSegment {
  fromIdx: number;
  toIdx: number;
  fromPhaseId: number;
  toPhaseId: number;
  edges: Edge[]; // the dependencies riding this stretch
  done: boolean; // every dependency riding this stretch departs a completed phase
  onChain: boolean;
}

export interface Bundle {
  key: string;
  /** 'out' = one phase feeds many; 'in' = many phases feed one. */
  kind: 'out' | 'in';
  hubId: number;
  lane: number; // 1.. — outward from the main line
  fromIdx: number; // topmost tie
  toIdx: number; // bottom-most tie
  ties: BundleTie[]; // sorted top → bottom
  segments: TrunkSegment[]; // ties.length - 1 of them, top → bottom
  edges: Edge[];
  /**
   * Every dependency on this line is on a path through the traced phase. Always
   * false with no trace running. A bundle is never MIXED (see bundleEdges), so
   * this is a property of the whole line rather than of each rider.
   */
  traced: boolean;
}

interface Group {
  key: string;
  kind: 'out' | 'in';
  hubIdx: number;
  edges: Edge[];
}

/**
 * Greedy set cover: repeatedly take the largest remaining set of bypasses sharing an
 * endpoint. Ties break on kind then hub position, so the grouping is deterministic
 * regardless of input order. Leftovers become bundles of one (drawn exactly as the
 * single bypass loop always was).
 */
function groupBypasses(bypasses: Edge[], ordered: LayoutRow[]): Group[] {
  const topId = (e: Edge) => ordered[e.fromIdx].id;
  const botId = (e: Edge) => ordered[e.toIdx].id;
  const remaining = new Set(bypasses);
  const groups: Group[] = [];

  for (;;) {
    const buckets = new Map<string, Edge[]>();
    for (const e of remaining) {
      for (const key of [`out:${topId(e)}`, `in:${botId(e)}`]) {
        buckets.set(key, [...(buckets.get(key) ?? []), e]);
      }
    }
    let best: Group | null = null;
    for (const [key, edges] of buckets) {
      if (edges.length < 2) continue;
      const kind = key.startsWith('out:') ? 'out' as const : 'in' as const;
      const hubIdx = kind === 'out' ? edges[0].fromIdx : edges[0].toIdx;
      const candidate: Group = { key, kind, hubIdx, edges };
      if (!best || betterGroup(candidate, best)) best = candidate;
    }
    if (!best) break;
    groups.push(best);
    best.edges.forEach((e) => remaining.delete(e));
  }

  for (const e of remaining) {
    groups.push({ key: `out:${topId(e)}:${botId(e)}`, kind: 'out', hubIdx: e.fromIdx, edges: [e] });
  }
  return groups;
}

const betterGroup = (a: Group, b: Group): boolean =>
  a.edges.length !== b.edges.length ? a.edges.length > b.edges.length
    : a.kind !== b.kind ? a.kind < b.kind
      : a.hubIdx !== b.hubIdx ? a.hubIdx < b.hubIdx
        : a.key < b.key;

function buildBundle(g: Group, ordered: LayoutRow[]): Omit<Bundle, 'lane' | 'traced'> {
  const tieIdxs = [...new Set(g.edges.flatMap((e) => [e.fromIdx, e.toIdx]))].sort((a, b) => a - b);
  const hubId = ordered[g.hubIdx].id;
  const ties: BundleTie[] = tieIdxs.map((i) => {
    const edges = g.edges.filter((e) => e.fromIdx === i || e.toIdx === i);
    return {
      phaseId: ordered[i].id, idx: i, edges, isHub: i === g.hubIdx,
      done: edges.every((e) => e.done), onChain: edges.every((e) => e.onChain),
    };
  });
  const segments: TrunkSegment[] = [];
  for (let k = 0; k + 1 < ties.length; k++) {
    const a = ties[k], b = ties[k + 1];
    // A dependency rides this stretch when its span covers both ends of it.
    const riding = g.edges.filter((e) => e.fromIdx <= a.idx && e.toIdx >= b.idx);
    segments.push({
      fromIdx: a.idx, toIdx: b.idx, fromPhaseId: a.phaseId, toPhaseId: b.phaseId, edges: riding,
      done: riding.length > 0 && riding.every((e) => e.done),
      onChain: riding.length > 0 && riding.every((e) => e.onChain),
    });
  }
  return {
    key: g.key, kind: g.kind, hubId, edges: g.edges, ties, segments,
    fromIdx: tieIdxs[0], toIdx: tieIdxs[tieIdxs.length - 1],
  };
}

/**
 * Interval coloring over BUNDLES rather than edges. Traced branches take the inner
 * lanes — the answer to the question belongs nearest the spine — then short branches,
 * so the long ones cross fewer ties. Two branches never share a lane when their spans
 * touch: a shared tie position would fuse them into one apparent line.
 */
function assignLanes(bundles: Omit<Bundle, 'lane'>[]): { bundles: Bundle[]; laneCount: number } {
  const order = [...bundles].sort((a, b) =>
    Number(b.traced) - Number(a.traced)
    || (a.toIdx - a.fromIdx) - (b.toIdx - b.fromIdx) || a.fromIdx - b.fromIdx || (a.key < b.key ? -1 : 1));
  const lanes: { from: number; to: number }[][] = [];
  const placed = new Map<string, number>();
  for (const b of order) {
    let lane = lanes.findIndex((held) => held.every((o) => b.toIdx < o.from || b.fromIdx > o.to));
    if (lane === -1) { lane = lanes.length; lanes.push([]); }
    lanes[lane].push({ from: b.fromIdx, to: b.toIdx });
    placed.set(b.key, lane + 1);
  }
  return {
    bundles: bundles.map((b) => ({ ...b, lane: placed.get(b.key)! })),
    laneCount: lanes.length,
  };
}

/**
 * Split dependency edges into main-line segments (adjacent stations) and bundled
 * branch lines (everything that skips a station), then lane the branches.
 *
 * With a trace running, the traced and untraced bypasses are bundled SEPARATELY, so
 * no line ever carries both. Sharing was the defect: bundle ink cannot be partly
 * lit, so one traced rider lit the whole stem — and that stem's label enumerated six
 * other phases sitting ghosted a few pixels away. A lit line has to mean exactly one
 * thing, "this dependency is on a path through the selected phase", and a mixed line
 * cannot. Partitioning keeps the promise while still merging within each side, so the
 * traced routes stay readable instead of exploding back into one lane per dependency
 * (tracing a convergence phase would be fifteen of them on the AAOS template).
 */
export function bundleEdges(
  ordered: LayoutRow[], chainKeys: Set<string>, focus?: FocusSet | null,
): { mainline: Edge[]; bundles: Bundle[]; laneCount: number; restingLaneCount: number } {
  const all = railEdges(ordered, chainKeys);
  const mainline = all.filter((e) => !isBypass(e));
  const bypasses = all.filter(isBypass);
  const onPath = (e: Edge) => !!focus && focus.edgeKeys.has(`${e.from}-${e.to}`);
  const lay = (edges: Edge[], traced: boolean, prefix: string) =>
    groupBypasses(edges, ordered).map((g) => {
      const b = buildBundle(g, ordered);
      return { ...b, key: `${prefix}${b.key}`, traced };
    });
  // Prefixed keys: the same hub can head a traced AND an untraced branch, and the two
  // are different lines that must not collide in the lane map or in React's keys.
  const built = focus
    ? [...lay(bypasses.filter((e) => !onPath(e)), false, 'rest:'), ...lay(bypasses.filter(onPath), true, 'trace:')]
    : lay(bypasses, false, '');
  const { bundles, laneCount } = assignLanes(built);
  // Splitting a bundle can need more lanes than the resting view. The GUTTER must not
  // grow to hold them: its width is the rows' left padding, so widening it re-wraps
  // every row and the whole list jumps vertically the moment you click. The caller
  // sizes the gutter from the resting count and fits any extra lanes into it by
  // narrowing the pitch — the rail gets denser, never wider.
  const restingLaneCount = focus ? assignLanes(lay(bypasses, false, '')).laneCount : laneCount;
  return { mainline, bundles, laneCount, restingLaneCount };
}

// ---------------------------------------------------------------------------
// FOCUS — "what does THIS phase depend on, and what is waiting on it?"
//
// The related set is the phase plus every ancestor and every descendant. An EDGE
// is related only when it lies on a path THROUGH the phase, which is exactly
// "both ends upstream" or "both ends downstream": ancestors are closed under
// parents, so an edge between two of them always continues to the selection. An
// edge from an ancestor straight to a descendant, bypassing the selection, has one
// end in each set and correctly stays out.
// ---------------------------------------------------------------------------

export interface FocusSet {
  id: number;
  upstream: Set<number>; // ancestors — what has to finish first
  downstream: Set<number>; // descendants — what is waiting
  nodes: Set<number>; // upstream ∪ downstream ∪ the phase itself
  edgeKeys: Set<string>; // `${from}-${to}` for every edge on a path through it
}

export function focusSubgraph(rows: LayoutRow[], selectedId: number | null): FocusSet | null {
  if (selectedId == null || !rows.some((r) => r.id === selectedId)) return null;
  const present = new Set(rows.map((r) => r.id));
  const parents = new Map<number, number[]>();
  const children = new Map<number, number[]>();
  for (const r of rows) {
    for (const p of r.parents) {
      if (!present.has(p.id)) continue;
      parents.set(r.id, [...(parents.get(r.id) ?? []), p.id]);
      children.set(p.id, [...(children.get(p.id) ?? []), r.id]);
    }
  }
  const walk = (adj: Map<number, number[]>): Set<number> => {
    const seen = new Set<number>();
    const queue = [selectedId];
    while (queue.length) {
      for (const next of adj.get(queue.shift()!) ?? []) {
        if (seen.has(next)) continue; // also the cycle guard
        seen.add(next);
        queue.push(next);
      }
    }
    return seen;
  };
  const upstream = walk(parents);
  const downstream = walk(children);
  const inUp = (x: number) => x === selectedId || upstream.has(x);
  const inDown = (x: number) => x === selectedId || downstream.has(x);
  const edgeKeys = new Set<string>();
  for (const r of rows) {
    for (const p of r.parents) {
      if (!present.has(p.id)) continue;
      if ((inUp(p.id) && inUp(r.id)) || (inDown(p.id) && inDown(r.id))) edgeKeys.add(`${p.id}-${r.id}`);
    }
  }
  return {
    id: selectedId, upstream, downstream,
    nodes: new Set([selectedId, ...upstream, ...downstream]),
    edgeKeys,
  };
}
