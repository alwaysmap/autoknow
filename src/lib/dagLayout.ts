// Grid-snapped, top-to-bottom layered layout for phase DAGs. General DAGs are the
// norm — a node may have MANY concurrent upstreams (fan-in) and MANY downstreams
// (fan-out); the only structural constraints live in validation (acyclic, single
// final node). The display must therefore handle diamonds and fan-outs legibly:
//   · level (row) = longest dependency path from any root — TOP → BOTTOM
//   · order within a level = barycenter of the neighbours' columns (one downward
//     pass on parents, one upward pass on children) to keep related nodes adjacent
//     and edge crossings low
//   · each level is centered on the widest level, so converging branches read as a
//     funnel into the single final node
// Pure and client-safe; unit-tested in tests/dagLayout.test.ts.

export interface DagLayoutNode {
  id: number;
  dependsOn: number[];
}

export interface DagLayoutDims {
  cardW: number;
  cardH: number;
  gapX: number;
  gapY: number;
  pad: number;
  grid: number; // snap lattice for the centering offset
}

export interface DagLayout {
  pos: Map<number, { x: number; y: number }>;
  w: number;
  h: number;
}

export function computeDagLayout(nodes: DagLayoutNode[], dims: DagLayoutDims): DagLayout {
  const { cardW, cardH, gapX, gapY, pad, grid } = dims;
  const snap = (v: number) => Math.round(v / grid) * grid;
  const ids = new Set(nodes.map((n) => n.id));
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // Level = longest path from roots (cycle-guarded: invalid drafts still render).
  const levelMemo = new Map<number, number>();
  const level = (id: number, seen: Set<number>): number => {
    if (levelMemo.has(id)) return levelMemo.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    const parents = (byId.get(id)?.dependsOn ?? []).filter((p) => ids.has(p));
    const l = parents.length === 0 ? 0 : Math.max(...parents.map((p) => level(p, seen))) + 1;
    levelMemo.set(id, l);
    return l;
  };
  nodes.forEach((n) => level(n.id, new Set()));

  const maxLevel = Math.max(0, ...levelMemo.values());
  const rows: number[][] = Array.from({ length: maxLevel + 1 }, () => []);
  for (const n of nodes) rows[levelMemo.get(n.id)!].push(n.id);

  const children = new Map<number, number[]>();
  for (const n of nodes) {
    for (const p of n.dependsOn) {
      if (ids.has(p)) children.set(p, [...(children.get(p) ?? []), n.id]);
    }
  }

  // Barycenter ordering: column index per node, refined by neighbours' columns.
  const col = new Map<number, number>();
  rows.forEach((row) => row.forEach((id, i) => col.set(id, i)));
  const reorder = (row: number[], neighbours: (id: number) => number[]) => {
    const keyed = row.map((id, i) => {
      const ns = neighbours(id).filter((x) => col.has(x));
      const key = ns.length === 0 ? col.get(id)! : ns.reduce((s, x) => s + col.get(x)!, 0) / ns.length;
      return { id, key, tie: i };
    });
    keyed.sort((a, b) => a.key - b.key || a.tie - b.tie);
    keyed.forEach(({ id }, i) => col.set(id, i));
    return keyed.map(({ id }) => id);
  };
  // Downward pass (parents pull children under them)…
  for (let l = 1; l <= maxLevel; l++) rows[l] = reorder(rows[l], (id) => byId.get(id)?.dependsOn ?? []);
  // …then upward (children pull shared parents together).
  for (let l = maxLevel - 1; l >= 0; l--) rows[l] = reorder(rows[l], (id) => children.get(id) ?? []);
  // …and once more down, so the up-pass can't undo the parent alignment at the top.
  for (let l = 1; l <= maxLevel; l++) rows[l] = reorder(rows[l], (id) => byId.get(id)?.dependsOn ?? []);

  // Positions: rows centered on the widest row; offsets snapped to the grid.
  const widest = Math.max(1, ...rows.map((r) => r.length));
  const rowWidth = (n: number) => n * (cardW + gapX) - gapX;
  const w = pad * 2 + rowWidth(widest);
  const pos = new Map<number, { x: number; y: number }>();
  rows.forEach((row, l) => {
    const offset = snap((rowWidth(widest) - rowWidth(row.length)) / 2);
    row.forEach((id, i) => {
      pos.set(id, { x: pad + offset + i * (cardW + gapX), y: pad + l * (cardH + gapY) });
    });
  });

  return { pos, w, h: pad * 2 + (maxLevel + 1) * (cardH + gapY) - gapY };
}
