import { validateTemplateDag } from '../src/lib/templateDag';

// The template DAG contract (PHASE_TEMPLATES_PLAN §4): acyclic, exactly one sink,
// that sink is the (single) isEndPhase node, and every node converges on it.
// Errors carry the offending node id so the editor can highlight it.

const node = (id: string, isEndPhase = false) => ({ id, isEndPhase });
const edge = (nodeId: string, dependsOnId: string) => ({ nodeId, dependsOnId });

describe('validateTemplateDag', () => {
  it('accepts a linear chain ending in the end phase', () => {
    const result = validateTemplateDag(
      [node('a'), node('b'), node('c', true)],
      [edge('b', 'a'), edge('c', 'b')],
    );
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('accepts a diamond that converges on a single end phase', () => {
    // a → b, a → c, then both join at d (the end phase).
    const result = validateTemplateDag(
      [node('a'), node('b'), node('c'), node('d', true)],
      [edge('b', 'a'), edge('c', 'a'), edge('d', 'b'), edge('d', 'c')],
    );
    expect(result.ok).toBe(true);
  });

  it('accepts a single node marked as the end phase', () => {
    const result = validateTemplateDag([node('only', true)], []);
    expect(result.ok).toBe(true);
  });

  it('rejects an empty template', () => {
    const result = validateTemplateDag([], []);
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain('empty');
  });

  it('rejects a cycle and names a node on it', () => {
    const result = validateTemplateDag(
      [node('a'), node('b'), node('c', true)],
      [edge('b', 'a'), edge('a', 'b'), edge('c', 'b')],
    );
    expect(result.ok).toBe(false);
    const cycle = result.errors.find((e) => e.code === 'cycle');
    expect(cycle).toBeDefined();
    expect(['a', 'b']).toContain(cycle!.nodeId);
  });

  it('rejects a branch that never rejoins (second sink), naming the stray sink', () => {
    // a → b(end); a → c, and c dead-ends.
    const result = validateTemplateDag(
      [node('a'), node('b', true), node('c')],
      [edge('b', 'a'), edge('c', 'a')],
    );
    expect(result.ok).toBe(false);
    const stray = result.errors.find((e) => e.code === 'multiple-sinks');
    expect(stray).toBeDefined();
    expect(stray!.nodeId).toBe('c');
  });

  it('rejects an end phase that is not the sink', () => {
    // a(end) → b: something depends on the end phase, and b is the real sink.
    const result = validateTemplateDag(
      [node('a', true), node('b')],
      [edge('b', 'a')],
    );
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain('end-not-sink');
  });

  it('rejects a template with no end phase marked', () => {
    const result = validateTemplateDag([node('a'), node('b')], [edge('b', 'a')]);
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain('no-end-phase');
  });

  it('rejects multiple nodes marked as the end phase, naming each', () => {
    const result = validateTemplateDag(
      [node('a', true), node('b', true)],
      [edge('b', 'a')],
    );
    expect(result.ok).toBe(false);
    const dupes = result.errors.filter((e) => e.code === 'multiple-end-phases');
    expect(dupes.length).toBeGreaterThan(0);
  });

  it('rejects an edge that references an unknown node', () => {
    const result = validateTemplateDag(
      [node('a', true)],
      [edge('a', 'ghost')],
    );
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain('unknown-node');
  });

  it('reports every node that cannot reach the end phase', () => {
    // Two disconnected islands: a→b(end) is fine; c→d floats free.
    const result = validateTemplateDag(
      [node('a'), node('b', true), node('c'), node('d')],
      [edge('b', 'a'), edge('d', 'c')],
    );
    expect(result.ok).toBe(false);
    const unreachable = result.errors.filter((e) => e.code === 'unreachable-end').map((e) => e.nodeId);
    expect(unreachable).toEqual(expect.arrayContaining(['c', 'd']));
  });
});
