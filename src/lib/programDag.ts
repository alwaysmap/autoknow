// Program phase graphs have no explicit isEndPhase column — the end phase IS the
// graph's unique sink. To reuse validateTemplateDag (acyclic, single sink, full
// convergence) we designate the deepest sink as "the" end and let the validator flag
// every OTHER sink as a dead-ending branch. With zero sinks a cycle exists and the
// validator reports that instead. Pure and client-safe: the editor validates live
// with the exact function the save action gates on.

export interface ProgramDagNode {
  id: number;
  name: string;
  sortOrder: number;
  dependsOn: number[];
}

export function deriveEndPhase<T extends ProgramDagNode>(nodes: T[]): (T & { isEndPhase: boolean })[] {
  const ids = new Set(nodes.map((n) => n.id));
  const upstreamIds = new Set(nodes.flatMap((n) => n.dependsOn.filter((d) => ids.has(d))));
  const sinks = nodes.filter((n) => !upstreamIds.has(n.id));

  // Deepest sink wins (longest dependency path from any root); ties break on order.
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const depthMemo = new Map<number, number>();
  const depth = (id: number, seen: Set<number>): number => {
    if (depthMemo.has(id)) return depthMemo.get(id)!;
    if (seen.has(id)) return 0; // cycle guard
    seen.add(id);
    const parents = (byId.get(id)?.dependsOn ?? []).filter((d) => ids.has(d));
    const d = parents.length === 0 ? 0 : Math.max(...parents.map((p) => depth(p, seen))) + 1;
    depthMemo.set(id, d);
    return d;
  };
  nodes.forEach((n) => depth(n.id, new Set()));

  let end: T | null = null;
  for (const s of sinks) {
    if (
      !end ||
      depthMemo.get(s.id)! > depthMemo.get(end.id)! ||
      (depthMemo.get(s.id) === depthMemo.get(end.id) && s.sortOrder > end.sortOrder)
    ) {
      end = s;
    }
  }

  return nodes.map((n) => ({ ...n, isEndPhase: n.id === end?.id }));
}
