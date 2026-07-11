// Template DAG validation (PHASE_TEMPLATES_PLAN §4). One pure function shared by the
// template editor, the save actions, and project instantiation. Rules:
//   - acyclic (a topological order exists)
//   - exactly one sink (a node nothing depends on), and it is the single isEndPhase
//     node — the program's final deliverable
//   - full convergence: every node has a directed path to that sink
// Errors carry the offending node id so the UI can highlight it. Client-safe: no
// server-only imports.

export type NodeId = number | string;

export interface TemplateDagNode {
  id: NodeId;
  isEndPhase: boolean;
  name?: string;
}

/** Edge semantics: `nodeId` DEPENDS ON `dependsOnId` (dependsOnId is upstream). */
export interface TemplateDagEdge {
  nodeId: NodeId;
  dependsOnId: NodeId;
}

export type DagErrorCode =
  | 'empty'
  | 'unknown-node'
  | 'cycle'
  | 'no-end-phase'
  | 'multiple-end-phases'
  | 'end-not-sink'
  | 'multiple-sinks'
  | 'unreachable-end';

export interface DagError {
  code: DagErrorCode;
  nodeId?: NodeId;
  message: string;
}

export interface DagValidation {
  ok: boolean;
  errors: DagError[];
}

export function validateTemplateDag(nodes: TemplateDagNode[], edges: TemplateDagEdge[]): DagValidation {
  const errors: DagError[] = [];

  if (nodes.length === 0) {
    return { ok: false, errors: [{ code: 'empty', message: 'A template needs at least one phase.' }] };
  }

  const ids = new Set(nodes.map((n) => n.id));
  const label = (id: NodeId) => {
    const n = nodes.find((x) => x.id === id);
    return n?.name ?? String(id);
  };

  // Edges must reference known nodes; drop broken ones from the graph checks.
  for (const e of edges) {
    for (const ref of [e.nodeId, e.dependsOnId]) {
      if (!ids.has(ref)) {
        errors.push({ code: 'unknown-node', nodeId: ref, message: `Dependency references an unknown phase (${String(ref)}).` });
      }
    }
  }
  const valid = edges.filter((e) => ids.has(e.nodeId) && ids.has(e.dependsOnId));

  // Downstream adjacency: upstream → the nodes that depend on it.
  const downstream = new Map<NodeId, NodeId[]>();
  for (const e of valid) {
    downstream.set(e.dependsOnId, [...(downstream.get(e.dependsOnId) ?? []), e.nodeId]);
  }

  // Cycle detection: DFS coloring over the downstream direction.
  const color = new Map<NodeId, 'visiting' | 'done'>();
  let cycleNode: NodeId | null = null;
  const visit = (id: NodeId) => {
    if (cycleNode !== null || color.get(id) === 'done') return;
    if (color.get(id) === 'visiting') { cycleNode = id; return; }
    color.set(id, 'visiting');
    for (const next of downstream.get(id) ?? []) visit(next);
    if (color.get(id) === 'visiting') color.set(id, 'done');
  };
  for (const n of nodes) visit(n.id);
  if (cycleNode !== null) {
    errors.push({ code: 'cycle', nodeId: cycleNode, message: `Dependencies form a cycle through “${label(cycleNode)}”.` });
  }

  // The end phase: exactly one, and it must be the graph's only sink.
  const ends = nodes.filter((n) => n.isEndPhase);
  if (ends.length === 0) {
    errors.push({ code: 'no-end-phase', message: 'Mark exactly one phase as the end phase — the final deliverable.' });
  } else if (ends.length > 1) {
    for (const n of ends) {
      errors.push({ code: 'multiple-end-phases', nodeId: n.id, message: `“${label(n.id)}” is one of ${ends.length} end phases; only one is allowed.` });
    }
  }

  // Sinks: nodes nothing depends on (never appear upstream of an edge).
  const upstreamIds = new Set(valid.map((e) => e.dependsOnId));
  const sinks = nodes.filter((n) => !upstreamIds.has(n.id));
  const end = ends.length === 1 ? ends[0] : null;

  if (end && upstreamIds.has(end.id)) {
    errors.push({ code: 'end-not-sink', nodeId: end.id, message: `Phases still depend on the end phase “${label(end.id)}” — it must be the final node.` });
  }
  for (const s of sinks) {
    if (!end || s.id !== end.id) {
      errors.push({ code: 'multiple-sinks', nodeId: s.id, message: `“${label(s.id)}” dead-ends — every branch must converge on the end phase.` });
    }
  }

  // Full convergence: everything reaches the end phase (walk upstream from it).
  if (end && cycleNode === null) {
    const reaches = new Set<NodeId>([end.id]);
    const upstreamOf = new Map<NodeId, NodeId[]>();
    for (const e of valid) {
      upstreamOf.set(e.nodeId, [...(upstreamOf.get(e.nodeId) ?? []), e.dependsOnId]);
    }
    const stack: NodeId[] = [end.id];
    while (stack.length) {
      for (const up of upstreamOf.get(stack.pop()!) ?? []) {
        if (!reaches.has(up)) { reaches.add(up); stack.push(up); }
      }
    }
    for (const n of nodes) {
      if (!reaches.has(n.id)) {
        errors.push({ code: 'unreachable-end', nodeId: n.id, message: `“${label(n.id)}” never reaches the end phase.` });
      }
    }
  }

  return { ok: errors.length === 0, errors };
}
