import { deriveEndPhase, type ProgramDagNode } from '../src/lib/programDag';

const node = (id: number, sortOrder: number, dependsOn: number[] = []): ProgramDagNode => ({
  id, name: `N${id}`, sortOrder, dependsOn,
});

const endId = (nodes: ProgramDagNode[]) => deriveEndPhase(nodes).find((n) => n.isEndPhase)?.id ?? null;

describe('deriveEndPhase', () => {
  it('marks the single sink as the end', () => {
    expect(endId([node(1, 0), node(2, 1, [1]), node(3, 2, [2])])).toBe(3);
  });

  it('a lone node is its own end', () => {
    expect(endId([node(1, 0)])).toBe(1);
  });

  it('picks the DEEPEST sink when several exist', () => {
    // sinks: 2 (depth 1) and 4 (depth 2). The deeper one is "the" end.
    const nodes = [node(1, 0), node(2, 1, [1]), node(3, 2, [1]), node(4, 3, [3])];
    expect(endId(nodes)).toBe(4);
  });

  it('breaks equal-depth ties on the higher sortOrder', () => {
    // 2 and 3 are both sinks at depth 1; sortOrder decides.
    const nodes = [node(1, 0), node(2, 5, [1]), node(3, 9, [1])];
    expect(endId(nodes)).toBe(3);
  });

  it('marks exactly one end phase', () => {
    const marked = deriveEndPhase([node(1, 0), node(2, 1, [1]), node(3, 2, [1])]);
    expect(marked.filter((n) => n.isEndPhase)).toHaveLength(1);
  });

  it('is cycle-guarded (no sink) and terminates', () => {
    const marked = deriveEndPhase([node(1, 0, [2]), node(2, 1, [1])]);
    // every node is upstream of another → no sink → no end, but it must not hang
    expect(marked.every((n) => !n.isEndPhase)).toBe(true);
  });
});
