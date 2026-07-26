// Shared, pure label de-collision for EVERY chart that places text at a data-derived
// coordinate (ChainSchedule, CapacityChart, CycleTimeScatterPlot). A label that overlaps
// another is useless (user call), so each label field runs its candidates through here
// before rendering. 2D, because lane labels sit at many x AND y. Pure, so it is
// unit-tested with zero DOM. Two strategies, because the field decides the trade-off:
//   • keepNonOverlapping HIDES the losers — right where a dropped label is redundant
//     (a y-axis tick still readable from the scale, a month letter yielding to a break).
//   • dodgeLabels KEEPS every label and nudges it in y — right where dropping one would
//     hide real information (a buffer-lane riser IS a buffer move; hiding it lies).
// Picking between them is a SEMANTIC call, not a style one: hide only what the reader can
// still recover from somewhere else on the chart.
//
// NEVER resolve a collision by shrinking type — the chart font sizes were raised once
// already for legibility (#83) and a de-collider that undoes that is a regression wearing
// a fix.

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

/** Advance width of one glyph, in em. Latin/digits average ~0.59em in the body face;
 *  anything above the CJK block boundary is full-width and then some. Deliberately an
 *  ESTIMATE: measuring text needs a DOM, and a layout that needs a DOM cannot be a pure
 *  function, cannot run on the server, and cannot be unit-tested against a crowding
 *  fixture. Erring wide is the safe direction — it buys a de-collider more clearance. */
const CHAR_EM = 0.59;
const WIDE_CHAR_EM = 1.09;
/** Above this code point, assume a full-width glyph (CJK, kana, hangul, their punctuation). */
const WIDE_FROM = 0x2e80;

/** Estimated rendered width of `s` at `fontSize` px — the halfW every PlacedLabel needs.
 *  ChainSchedule.tsx carries a private copy of this predating the module (its own
 *  `textWidth`, hard-coded at 6.5/12 px because every label there is 10–12px type);
 *  collapsing it onto this is deferred only because #161 steps 2–4 are rewriting that
 *  file right now. */
export const estimateTextWidth = (s: string, fontSize: number): number =>
  [...s].reduce((w, ch) => w + (ch.codePointAt(0)! > WIDE_FROM ? WIDE_CHAR_EM : CHAR_EM), 0) * fontSize;

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

/** A vertical band the dodged labels must stay within (the lane plot, roughly). */
export interface YBounds { top: number; bottom: number }

/** Place EVERY `movable` label, keeping its x / halfW / halfH but nudging its y to the
 *  nearest position free of the `fixed` labels and the movable labels already placed,
 *  clamped so the box stays inside [top, bottom]. Returns the chosen y per movable, in
 *  input order — so a cluster of near-coincident labels FANS OUT rather than any being
 *  dropped. Used for the buffer-lane risers, where hiding a step would hide a real move.
 *
 *  Greedy: process left-to-right (ties top-first) so stacks build in a stable order, and
 *  for each label take the smallest |Δy| slot that clears everything placed so far. If no
 *  gap exists within bounds (a genuinely full column), fall back to the clamped natural y
 *  and accept the overlap — a handful of labels in a lane never hits this. O(n² · span). */
export function dodgeLabels(fixed: PlacedLabel[], movable: PlacedLabel[], bounds: YBounds): number[] {
  const placed: PlacedLabel[] = [...fixed];
  const ys = new Array<number>(movable.length);
  const order = movable.map((_, i) => i).sort((a, b) =>
    movable[a].x - movable[b].x || movable[a].y - movable[b].y);
  const STEP = 2;
  for (const i of order) {
    const lbl = movable[i];
    const lo = bounds.top + lbl.halfH, hi = bounds.bottom - lbl.halfH;
    const clamp = (y: number) => Math.max(lo, Math.min(hi, y));
    const free = (y: number) => placed.every((p) => !overlaps({ ...lbl, y }, p));
    let chosen = clamp(lbl.y);
    if (!free(chosen)) {
      // spiral out from the natural y in both directions, nearest slot wins
      for (let d = STEP; d <= hi - lo + STEP; d += STEP) {
        const down = clamp(lbl.y + d), up = clamp(lbl.y - d);
        if (free(down)) { chosen = down; break; }
        if (free(up)) { chosen = up; break; }
      }
    }
    ys[i] = chosen;
    placed.push({ ...lbl, y: chosen });
  }
  return ys;
}
