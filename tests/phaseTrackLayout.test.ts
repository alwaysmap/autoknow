import {
  stationOrder, bundleEdges, focusSubgraph, type Bundle, type LayoutRow,
} from '../src/lib/phaseTrackLayout';

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

// Every dependency in the input must come back out exactly once, as a mainline
// segment or as one edge of one bundle — bundling merges LINES, never relationships.
const dependencyKeys = (rows: LayoutRow[]) =>
  new Set(rows.flatMap((r) => r.parents.filter((p) => rows.some((x) => x.id === p.id))
    .map((p) => `${p.id}-${r.id}`)));
const renderedKeys = (mainline: { from: number; to: number }[], bundles: Bundle[]) => {
  const keys = [
    ...mainline.map((e) => `${e.from}-${e.to}`),
    ...bundles.flatMap((b) => b.edges.map((e) => `${e.from}-${e.to}`)),
  ];
  expect(new Set(keys).size).toBe(keys.length); // no duplicates: no edge drawn twice
  return new Set(keys);
};

describe('bundleEdges', () => {
  it('keeps adjacent edges on the main line — no branch, no lane', () => {
    const ordered = [row(1), row(2, [1]), row(3, [2])];
    const { mainline, bundles, laneCount } = bundleEdges(ordered, new Set());
    expect(mainline).toHaveLength(2);
    expect(bundles).toHaveLength(0);
    expect(laneCount).toBe(0);
  });

  it('draws a lone station-skipping edge as a one-edge branch in the first lane', () => {
    // 1→3 skips station 2 → a branch with a tie at each end and one trunk stretch
    const ordered = [row(1), row(2, [1]), row(3, [1, 2])];
    const { bundles, laneCount } = bundleEdges(ordered, new Set());
    expect(laneCount).toBe(1);
    expect(bundles).toHaveLength(1);
    expect(bundles[0].lane).toBe(1);
    expect(bundles[0].ties.map((t) => t.phaseId)).toEqual([1, 3]);
    expect(bundles[0].segments).toHaveLength(1);
  });

  it('gives bypasses that share NO endpoint distinct lanes (interval coloring)', () => {
    const ordered = [row(0), row(1), row(2), row(3), row(4, [1]), row(5, [2])];
    const { bundles, laneCount } = bundleEdges(ordered, new Set());
    expect(laneCount).toBe(2);
    expect(new Set(bundles.map((b) => b.lane)).size).toBe(2);
  });

  it('merges a fan-OUT into ONE branch with a tie per phase it feeds', () => {
    // 1 feeds 3, 4 and 5 — six lanes' worth of loops collapse to one branch line
    const ordered = [row(1), row(2, [1]), row(3, [1]), row(4, [1]), row(5, [1])];
    const { bundles, laneCount } = bundleEdges(ordered, new Set());
    expect(laneCount).toBe(1);
    expect(bundles).toHaveLength(1);
    expect(bundles[0].kind).toBe('out');
    expect(bundles[0].hubId).toBe(1);
    expect(bundles[0].ties.map((t) => t.phaseId)).toEqual([1, 3, 4, 5]);
    expect(bundles[0].ties.filter((t) => t.isHub).map((t) => t.phaseId)).toEqual([1]);
    expect(bundles[0].segments).toHaveLength(3);
  });

  it('merges a fan-IN into ONE branch, hub last', () => {
    const ordered = [row(1), row(2), row(3), row(4), row(5, [1, 2, 3])];
    const { bundles, laneCount } = bundleEdges(ordered, new Set());
    expect(laneCount).toBe(1);
    expect(bundles[0].kind).toBe('in');
    expect(bundles[0].hubId).toBe(5);
    expect(bundles[0].ties.map((t) => t.phaseId)).toEqual([1, 2, 3, 5]);
  });

  it('never lets two branches touch in one lane (a shared tie would fuse them)', () => {
    // 1→3 and 3→5 meet exactly at station 3: same lane would draw one long line
    // through 3 and claim 1→5.
    const ordered = [row(1), row(2), row(3, [1]), row(4), row(5, [3])];
    const { bundles, laneCount } = bundleEdges(ordered, new Set());
    expect(laneCount).toBe(2);
    expect(bundles[0].lane).not.toBe(bundles[1].lane);
  });

  it('inks a trunk stretch only when EVERY dependency riding it has departed', () => {
    // 1 (done) and 2 (not) both feed 5 → the shared stretch below 2 is mixed
    const ordered = [row(1, [], 100), row(2, [], 40), row(3), row(4), row(5, [1, 2])];
    const { bundles } = bundleEdges(ordered, new Set());
    const b = bundles[0];
    expect(b.ties.find((t) => t.phaseId === 1)!.done).toBe(true);
    expect(b.ties.find((t) => t.phaseId === 2)!.done).toBe(false);
    // stretch 1→2 carries only the done dependency; 2→5 carries both
    expect(b.segments[0].done).toBe(true);
    expect(b.segments[1].done).toBe(false);
  });

  it('flags chain edges and the done state of the departing phase', () => {
    const ordered = [row(1, [], 100), row(2, [1], 50)];
    const { mainline } = bundleEdges(ordered, new Set(['1-2']));
    expect(mainline[0].onChain).toBe(true);
    expect(mainline[0].done).toBe(true);
  });

  // The program this whole change exists for: the built-in AAOS template as it
  // renders on Ford Evos — one phase feeding six workstreams that all converge on
  // one compliance gate. Fifteen bypasses used to claim nine parallel lanes.
  const fordEvos = (): LayoutRow[] => [
    row(1), row(2, [1]), row(3, [2]), row(4, [3]), row(5, [4]),
    row(6, [3]), row(7, [3]), row(8, [7, 5, 6]), row(9, [3]), row(10, [3]),
    row(11, [3]), row(12, [3]), row(13, [12, 4, 6, 7, 8, 9, 10, 11]), row(14, [13]), row(15, [14]),
  ];

  it('collapses the Ford Evos thicket from nine lanes to three', () => {
    const { bundles, laneCount } = bundleEdges(fordEvos(), new Set());
    expect(laneCount).toBe(3);
    expect(bundles).toHaveLength(3);
    expect(bundles.map((b) => b.edges.length).sort((a, b) => b - a)).toEqual([7, 6, 2]);
    // the two big ones are the fan-in to the compliance gate and the fan-out of BSP
    expect(bundles.find((b) => b.edges.length === 7)).toMatchObject({ kind: 'in', hubId: 13 });
    expect(bundles.find((b) => b.edges.length === 6)).toMatchObject({ kind: 'out', hubId: 3 });
  });

  it('renders every dependency exactly once and invents none', () => {
    const rows = fordEvos();
    const { mainline, bundles } = bundleEdges(rows, new Set());
    expect(renderedKeys(mainline, bundles)).toEqual(dependencyKeys(rows));
  });

  it('gives every bundled dependency a tie at BOTH of its endpoints', () => {
    const { bundles } = bundleEdges(fordEvos(), new Set());
    for (const b of bundles) {
      const tied = new Set(b.ties.map((t) => t.phaseId));
      for (const e of b.edges) {
        expect(tied.has(e.from)).toBe(true);
        expect(tied.has(e.to)).toBe(true);
      }
      // and no tie exists for a phase that is not an endpoint of some edge here
      const ends = new Set(b.edges.flatMap((e) => [e.from, e.to]));
      expect([...tied].every((id) => ends.has(id))).toBe(true);
    }
  });

  it('is deterministic regardless of the order dependencies arrive in', () => {
    const shuffled = fordEvos().map((r) => ({ ...r, parents: [...r.parents].reverse() }));
    const a = bundleEdges(fordEvos(), new Set());
    const b = bundleEdges(shuffled, new Set());
    expect(b.laneCount).toBe(a.laneCount);
    expect(b.bundles.map((x) => `${x.key}@${x.lane}`).sort())
      .toEqual(a.bundles.map((x) => `${x.key}@${x.lane}`).sort());
  });
});

describe('focusSubgraph', () => {
  // 1 → 2 → 3 → 4, plus an off-path 5 fed by 1, and 1 → 4 straight through.
  const rows = [row(1), row(2, [1]), row(3, [2]), row(4, [3, 1]), row(5, [1])];

  it('is null with nothing selected, and for a phase that is not here', () => {
    expect(focusSubgraph(rows, null)).toBeNull();
    expect(focusSubgraph(rows, 99)).toBeNull();
  });

  it('collects transitive ancestors and descendants', () => {
    const f = focusSubgraph(rows, 3)!;
    expect([...f.upstream].sort()).toEqual([1, 2]);
    expect([...f.downstream].sort()).toEqual([4]);
    expect([...f.nodes].sort()).toEqual([1, 2, 3, 4]);
    expect(f.nodes.has(5)).toBe(false);
  });

  it('excludes an edge that skips PAST the selection', () => {
    // 1→4 has both ends in the related set but never passes through 3
    const f = focusSubgraph(rows, 3)!;
    expect([...f.edgeKeys].sort()).toEqual(['1-2', '2-3', '3-4']);
    expect(f.edgeKeys.has('1-4')).toBe(false);
    expect(f.edgeKeys.has('1-5')).toBe(false);
  });

  it('keeps every edge between two ancestors, since ancestors all lead to it', () => {
    // diamond above 4: 1 → {2,6} → 3 → 4
    const diamond = [row(1), row(2, [1]), row(6, [1]), row(3, [2, 6]), row(4, [3])];
    const f = focusSubgraph(diamond, 4)!;
    expect([...f.upstream].sort()).toEqual([1, 2, 3, 6]);
    expect([...f.edgeKeys].sort()).toEqual(['1-2', '1-6', '2-3', '3-4', '6-3']);
  });

  it('is cycle-guarded', () => {
    const cyclic = [row(1, [2]), row(2, [1])];
    expect(() => focusSubgraph(cyclic, 1)).not.toThrow();
    expect(focusSubgraph(cyclic, 1)!.nodes.has(2)).toBe(true);
  });
});
