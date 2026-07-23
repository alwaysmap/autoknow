// Shared, pure label de-collision for the Critical Chain chart (ChainSchedule). A label
// that overlaps another is useless (user call), so each label field — the axis (break
// durations vs month letters) and the buffer lane (y-axis values, reserve, start, risers,
// now) — runs its candidates through this before rendering. 2D, because lane labels sit at
// many x AND y. Pure, so it is unit-tested with zero DOM.

/** A label candidate: its CENTRE (`x`,`y`), half-width/half-height, and `priority` (higher
 *  wins a contested slot; ties keep the earlier x). The caller must pass the centre — for
 *  an end-anchored label that is `x - halfW`, for a start-anchored one `x + halfW`. */
export interface PlacedLabel {
  x: number;
  y: number;
  halfW: number;
  halfH: number;
  priority: number;
}

const overlaps = (a: PlacedLabel, b: PlacedLabel): boolean =>
  Math.abs(a.x - b.x) < a.halfW + b.halfW && Math.abs(a.y - b.y) < a.halfH + b.halfH;

/** Returns, in input order, which labels to KEEP so no two kept labels' boxes overlap.
 *  Greedy by priority then x; O(n²), which is nothing for the handful a chart draws. */
export function keepNonOverlapping(labels: PlacedLabel[]): boolean[] {
  const keep = new Array<boolean>(labels.length).fill(false);
  const placed: PlacedLabel[] = [];
  const order = labels.map((_, i) => i).sort((a, b) =>
    labels[b].priority - labels[a].priority || labels[a].x - labels[b].x);
  for (const i of order) {
    if (placed.every((p) => !overlaps(labels[i], p))) { keep[i] = true; placed.push(labels[i]); }
  }
  return keep;
}
