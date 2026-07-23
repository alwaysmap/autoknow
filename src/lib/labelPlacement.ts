// Shared, pure label de-collision for the Critical Chain chart (ChainSchedule). A label
// that overlaps another is useless (user call), so every label row — the axis (break
// durations vs month letters), the buffer lane (start / risers / now) — runs its
// candidates through this before rendering. Pure, so it is unit-tested with zero DOM.

/** A label candidate: its centre `x`, half-width, and `priority` (higher wins a contested
 *  slot; ties keep the earlier x). Widths and x are in the caller's units. */
export interface PlacedLabel {
  x: number;
  half: number;
  priority: number;
}

/** Returns, in the input order, which labels to KEEP so no two kept labels' `[x±half]`
 *  ranges overlap. Greedy by priority then x; O(n²), which is nothing for a handful. */
export function keepNonOverlapping(labels: PlacedLabel[]): boolean[] {
  const keep = new Array<boolean>(labels.length).fill(false);
  const placed: { lo: number; hi: number }[] = [];
  const order = labels.map((_, i) => i).sort((a, b) =>
    labels[b].priority - labels[a].priority || labels[a].x - labels[b].x);
  for (const i of order) {
    const lo = labels[i].x - labels[i].half, hi = labels[i].x + labels[i].half;
    if (placed.every((p) => hi <= p.lo || lo >= p.hi)) { keep[i] = true; placed.push({ lo, hi }); }
  }
  return keep;
}
