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

/** A BOX to be cleared: its CENTRE (`x`,`y`), half-width/half-height, and `priority` (higher
 *  wins a contested slot; ties keep the earlier x). The caller must pass the centre — for
 *  an end-anchored label that is `x - halfW`, for a start-anchored one `x + halfW`.
 *
 *  Usually a label, but NOT only a label — see `dodgeLabels`' `fixed` and `inkBox`. */
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
 *  fixture.
 *
 *  TUNING, both directions. Too WIDE only wastes clearance — a de-collider dodges labels
 *  that would have fitted. Too NARROW is the dangerous one and is SILENT: boxes
 *  under-reserve, every function here reports clear, and the labels overlap on screen
 *  anyway. No test catches that, because the tests build their boxes from this same
 *  estimator — only a screenshot does. So err wide.
 *
 *  0.59 is the observed average advance of digits and lower-case latin in the body face
 *  at chart sizes, rounded up. `WIDE_FROM` is the ONLY script split: Arabic, Devanagari,
 *  Thai and friends are all charged the latin rate, which is the narrow (unsafe)
 *  direction for them — widen the rule, not the constant, if that ever matters. */
const CHAR_EM = 0.59;
const WIDE_CHAR_EM = 1.09;
/** Above this code point, assume a full-width glyph (CJK, kana, hangul, their punctuation). */
const WIDE_FROM = 0x2e80;

/** Estimated rendered width of `s` at `fontSize` px — the halfW every PlacedLabel needs.
 *  ChainSchedule.tsx carries a private copy predating this module (its own `textWidth`,
 *  hard-coded at 6.5/12 px). Collapsing them is bead autoknow-9xf, deferred because #161
 *  steps 2–4 are rewriting that file. NOTE for whoever does it: the two are NOT
 *  equivalent — 6.5/12 is 0.542em/1.0em against this module's 0.59/1.09, so every
 *  ChainSchedule box widens ~9% on the swap. That is the correct direction (see TUNING
 *  above), but it is a real layout change, not a no-op refactor. */
export const estimateTextWidth = (s: string, fontSize: number): number =>
  [...s].reduce((w, ch) => w + (ch.codePointAt(0)! > WIDE_FROM ? WIDE_CHAR_EM : CHAR_EM), 0) * fontSize;

/** Half the cap height, in em. SVG places text by its BASELINE; every function in this
 *  module reasons about box CENTRES (see PlacedLabel). That mismatch is the module's one
 *  real trap, so the conversion lives here and is not re-derived per chart — two call
 *  sites had already hand-tuned two different magic numbers for it. */
const CAP_HALF_EM = 0.32;

/** An SVG text baseline → the box centre `PlacedLabel` wants. Convert BEFORE placing. */
export const baselineToCentreY = (baselineY: number, fontSize: number): number =>
  baselineY - fontSize * CAP_HALF_EM;

/** A placed box centre → the `y` an SVG `<text>` takes. Convert AFTER placing. */
export const centreToBaselineY = (centreY: number, fontSize: number): number =>
  centreY + fontSize * CAP_HALF_EM;

/** The `halfH` a label of `fontSize` reserves: half the em box plus a point of air, so
 *  two labels at rest have a visible gap rather than kissing. Here for the same reason
 *  `CAP_HALF_EM` is — four call sites had hand-copied it. */
export const halfHFor = (fontSize: number): number => fontSize / 2 + 1;

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

/** An axis-aligned line of INK — a gridline, a threshold, a marker tick, a span of a
 *  polyline — as the box a label has to clear. Ink is not a label, and until #161 nobody
 *  passed any: `ChainSchedule`'s buffer flow handed `dodgeLabels` its gridlines' TICK
 *  CAPTIONS, ~30px boxes in the left gutter, while the rules they name are painted right
 *  across the plot. Nothing inside the plot can overlap a gutter box in x, so the pass
 *  reported clear and the reading printed on the rule. Charge the stroke to the box in
 *  both axes: over-reserving costs a label a few px of dodge, under-reserving is silent. */
export const inkBox = (x1: number, y1: number, x2: number, y2: number, strokeW: number): PlacedLabel => ({
  x: (x1 + x2) / 2, y: (y1 + y2) / 2,
  halfW: Math.abs(x2 - x1) / 2 + strokeW / 2,
  halfH: Math.abs(y2 - y1) / 2 + strokeW / 2,
  priority: 0,
});

/** A vertical band the dodged labels must stay within (the lane plot, roughly). */
export interface YBounds { top: number; bottom: number }

/** Place EVERY `movable` label, keeping its x / halfW / halfH but nudging its y to the
 *  nearest position free of everything in `fixed` and of the movable labels already
 *  placed, clamped so the box stays inside [top, bottom]. Returns the chosen y per
 *  movable, in input order — so a cluster of near-coincident labels FANS OUT rather than
 *  any being dropped. Used for the buffer-lane risers, where hiding a step would hide a
 *  real move.
 *
 *  `fixed` is EVERYTHING THE MOVABLES MUST CLEAR, not "the labels already placed" — a
 *  full-plot-width gridline belongs in it as a box (`inkBox`); its tick caption does not
 *  stand in for it. Read that sentence twice: three charts here passed only labels, and
 *  the one whose rules ran under its readings shipped a reading printed on a gridline.
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
    // One scratch box, mutated, rather than `overlaps({ ...lbl, y }, p)`: that spread ran
    // once per probe, and the probe count grew by an order of magnitude when the ink
    // joined `fixed` — order 10⁴ throwaway boxes per render of a chart that re-renders on
    // every mousemove. The RULE stays in `overlaps`; a second copy of it here would be
    // the two-copies-free-to-drift trap this module exists to close.
    const probe = { ...lbl };
    const free = (y: number) => { probe.y = y; return placed.every((p) => !overlaps(probe, p)); };
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
