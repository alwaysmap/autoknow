import { stationOrder, classifyEdges, type LayoutRow } from '../src/lib/phaseTrackLayout';

const row = (id: number, parents: number[] = [], progress = 0): LayoutRow => ({
  id, progress, parents: parents.map((p) => ({ id: p })),
});

// Every dependency must point DOWN the rail: a parent station always sits above its
// children. (The old chain-first ordering exiled off-chain phases below the whole
// chain, producing upward edges whose bypass geometry exploded into off-panel arcs.)
const expectDownwardEdges = (rows: LayoutRow[], chain: number[]) => {
  const ordered = stationOrder(rows, chain);
  const idx = new Map(ordered.map((r, i) => [r.id, i]));
  ordered.forEach((r) =>
    r.parents.forEach((p) => {
      if (idx.has(p.id)) expect(idx.get(p.id)!).toBeLessThan(idx.get(r.id)!);
    }),
  );
  return ordered.map((r) => r.id);
};

describe('stationOrder', () => {
  it('keeps the chain in chain order and every edge pointing down', () => {
    const rows = [row(3, [2]), row(1), row(2, [1]), row(4, [1])];
    const ordered = expectDownwardEdges(rows, [1, 2, 3]);
    // chain relative order preserved
    expect(ordered.indexOf(1)).toBeLessThan(ordered.indexOf(2));
    expect(ordered.indexOf(2)).toBeLessThan(ordered.indexOf(3));
    expect(ordered).toContain(4);
  });

  it('interleaves an off-chain feeder ABOVE the chain station it feeds (diamond)', () => {
    // 1 → {2 (chain), 5 (off-chain)} → 3 → 4: 5 must sit above 3, not below the chain.
    const rows = [row(1), row(2, [1]), row(5, [1]), row(3, [2, 5]), row(4, [3])];
    const ordered = expectDownwardEdges(rows, [1, 2, 3, 4]);
    expect(ordered.indexOf(5)).toBeLessThan(ordered.indexOf(3));
  });

  it('handles a wide fan that rejoins (3 parallel branches)', () => {
    const rows = [row(1), row(2, [1]), row(3, [1]), row(4, [1]), row(5, [2, 3, 4]), row(6, [5])];
    expectDownwardEdges(rows, [1, 3, 5, 6]);
  });

  it('orders off-chain phases by depth then id', () => {
    // no chain: pure topological order. 1 (root), then 2 & 3 (depth 1, id order), then 4
    const rows = [row(4, [2]), row(2, [1]), row(3, [1]), row(1)];
    expect(stationOrder(rows, []).map((r) => r.id)).toEqual([1, 2, 3, 4]);
  });

  it('is cycle-guarded', () => {
    const rows = [row(1, [2]), row(2, [1])];
    expect(() => stationOrder(rows, [])).not.toThrow();
  });
});

describe('classifyEdges', () => {
  it('marks adjacent edges as mainline (lane 0)', () => {
    const ordered = [row(1), row(2, [1]), row(3, [2])];
    const { edges, laneCount } = classifyEdges(ordered, new Set());
    expect(edges.every((e) => e.lane === 0)).toBe(true);
    expect(laneCount).toBe(0);
  });

  it('assigns a station-skipping edge to an outer bypass lane', () => {
    // 1→3 skips station 2 → bypass lane 1
    const ordered = [row(1), row(2, [1]), row(3, [1, 2])];
    const { edges, laneCount } = classifyEdges(ordered, new Set());
    const bypass = edges.find((e) => e.from === 1 && e.to === 3);
    expect(bypass?.lane).toBe(1);
    expect(laneCount).toBe(1);
  });

  it('gives overlapping bypasses distinct lanes (interval coloring)', () => {
    // 1→4 and 2→5 overlap → different lanes; 0..5 as stations
    const ordered = [row(0), row(1), row(2), row(3), row(4, [1]), row(5, [2])];
    const { laneCount } = classifyEdges(ordered, new Set());
    expect(laneCount).toBe(2);
  });

  it('flags chain edges and the done state of the departing phase', () => {
    const ordered = [row(1, [], 100), row(2, [1], 50)];
    const { edges } = classifyEdges(ordered, new Set(['1-2']));
    expect(edges[0].onChain).toBe(true);
    expect(edges[0].done).toBe(true);
  });
});
