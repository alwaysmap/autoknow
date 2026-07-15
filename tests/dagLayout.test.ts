import { computeDagLayout, DagLayoutDims } from '../src/lib/dagLayout';

// The card-DAG canvas layout must handle GENERAL DAGs: fan-out (2+ downstreams),
// fan-in (2+ concurrent upstreams), diamonds, and long edges — top → bottom by
// dependency depth, grid-snapped, levels centered on the widest level.

const DIMS: DagLayoutDims = { cardW: 144, cardH: 36, gapX: 24, gapY: 60, pad: 24, grid: 24 };
const STEP_Y = DIMS.cardH + DIMS.gapY;

const at = (l: ReturnType<typeof computeDagLayout>, id: number) => l.pos.get(id)!;

describe('computeDagLayout', () => {
  it('lays a chain out top to bottom, one level per link', () => {
    const l = computeDagLayout(
      [
        { id: 1, dependsOn: [] },
        { id: 2, dependsOn: [1] },
        { id: 3, dependsOn: [2] },
      ],
      DIMS,
    );
    expect(at(l, 1).y).toBe(DIMS.pad);
    expect(at(l, 2).y).toBe(DIMS.pad + STEP_Y);
    expect(at(l, 3).y).toBe(DIMS.pad + 2 * STEP_Y);
    // A chain is one column wide — everything shares x.
    expect(new Set([at(l, 1).x, at(l, 2).x, at(l, 3).x]).size).toBe(1);
  });

  it('handles a diamond: fan-out to 2 concurrent nodes, fan-in to a single end', () => {
    //      1
    //     / \
    //    2   3
    //     \ /
    //      4
    const l = computeDagLayout(
      [
        { id: 1, dependsOn: [] },
        { id: 2, dependsOn: [1] },
        { id: 3, dependsOn: [1] },
        { id: 4, dependsOn: [2, 3] },
      ],
      DIMS,
    );
    // 2 and 3 are CONCURRENT — same level, distinct positions.
    expect(at(l, 2).y).toBe(at(l, 3).y);
    expect(at(l, 2).x).not.toBe(at(l, 3).x);
    // The join sits below both, horizontally between/centered on its parents (±grid snap).
    expect(at(l, 4).y).toBe(at(l, 2).y + STEP_Y);
    const mid = (at(l, 2).x + at(l, 3).x) / 2;
    expect(Math.abs(at(l, 4).x - mid)).toBeLessThanOrEqual(DIMS.grid);
    // Root is centered over its two children too.
    expect(Math.abs(at(l, 1).x - mid)).toBeLessThanOrEqual(DIMS.grid);
  });

  it('keeps multi-parent children below their DEEPEST upstream', () => {
    // 1 → 2 → 3, and 1 → 3 directly: 3 must sit below 2 (level 2), not beside it.
    const l = computeDagLayout(
      [
        { id: 1, dependsOn: [] },
        { id: 2, dependsOn: [1] },
        { id: 3, dependsOn: [2, 1] },
      ],
      DIMS,
    );
    expect(at(l, 3).y).toBe(at(l, 2).y + STEP_Y);
  });

  it('never overlaps nodes, and snaps every position to the grid', () => {
    // Two independent 2-wide branches converging: 6 nodes, mixed fan-in/out.
    const l = computeDagLayout(
      [
        { id: 1, dependsOn: [] },
        { id: 2, dependsOn: [] },
        { id: 3, dependsOn: [1, 2] },
        { id: 4, dependsOn: [1] },
        { id: 5, dependsOn: [3, 4] },
        { id: 6, dependsOn: [5] },
      ],
      DIMS,
    );
    const seen = new Set<string>();
    for (const [, p] of l.pos) {
      const key = `${p.x},${p.y}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
      expect(p.x % DIMS.grid).toBe(0);
      expect(p.y % DIMS.grid).toBe(0);
    }
  });

  it('groups siblings under shared parents (barycenter, not insertion order)', () => {
    // Parents A(1),B(2); A's children 3,5; B's children 4,6 — interleaved on input.
    const l = computeDagLayout(
      [
        { id: 1, dependsOn: [] },
        { id: 2, dependsOn: [] },
        { id: 3, dependsOn: [1] },
        { id: 4, dependsOn: [2] },
        { id: 5, dependsOn: [1] },
        { id: 6, dependsOn: [2] },
        { id: 7, dependsOn: [3, 4, 5, 6] }, // single end
      ],
      DIMS,
    );
    // Each parent's children end up adjacent, not interleaved with the other's.
    const xs = [3, 5, 4, 6].map((id) => at(l, id).x).sort((a, b) => a - b);
    const aXs = [at(l, 3).x, at(l, 5).x].sort((a, b) => a - b);
    const bXs = [at(l, 4).x, at(l, 6).x].sort((a, b) => a - b);
    const adjacent = (pair: number[]) => xs.indexOf(pair[1]) - xs.indexOf(pair[0]) === 1;
    expect(adjacent(aXs)).toBe(true);
    expect(adjacent(bXs)).toBe(true);
  });

  it('survives a cycle (invalid draft) without hanging or losing nodes', () => {
    const l = computeDagLayout(
      [
        { id: 1, dependsOn: [2] },
        { id: 2, dependsOn: [1] },
      ],
      DIMS,
    );
    expect(l.pos.size).toBe(2);
  });
});
