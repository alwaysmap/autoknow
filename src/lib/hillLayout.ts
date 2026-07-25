// Layout math for the program summary hill (PhaseHillChart): where every phase's dot
// sits on the curve, and which labels get to exist. Kept OUT of the component so the two
// hard parts are unit-testable, and so the whole thing is provably deterministic — the
// chart renders on the server and hydrates on the client, so a `Math.random()` jitter
// would produce a hydration mismatch. Every offset here is derived from the input order.
//
// Two problems this solves, both of which broke a 15-phase program:
//
// 1. COINCIDENT DOTS. Progress is the x axis, so every Done phase lands on exactly one
//    coordinate and every Not-Started one on another — ten dots on two pixels, nine of
//    them invisible. Fixed by a swarm: a dot whose x is within a dot-diameter of one
//    already placed on its level moves to the next level UP (or down, near the crest),
//    so a tie renders as a shingled stack of coins. x — the axis that carries the
//    meaning — is never moved; the separation happens along y, which carries none.
//
// 2. LABEL COLLISION. Fifteen names do not fit. Labels are placed in priority order
//    (IN-PROGRESS FIRST — the phases someone is actually working on are the ones worth
//    naming), each taking the first slot that clears everything already placed; a stack
//    of two or more same-status dots collapses to ONE label naming the status, and
//    anything left with nowhere to go is dropped. A dropped LABEL is fine; a dropped
//    DOT is not, so the dot always renders and always keeps its own hit area.
//
// The viewBox is derived from the finished layout rather than fixed, so nothing can be
// clipped at an edge no matter how tall a stack or how long a name gets.

import { hillCoordinates } from './geometry';

export type HillStatus = 'notStarted' | 'inProgress' | 'done';

export interface HillPhase {
  id: number;
  name: string;
  progress: number; // 0..100
}

export interface HillDot {
  id: number;
  name: string;
  progress: number;
  status: HillStatus;
  x: number;
  y: number;
  r: number;
  hitR: number; // invisible touch target: at least `r`; otherwise half the gap to the nearest dot, capped at hitRadius
  level: number; // 0 = on the curve, 1.. = fanned off it
}

export interface HillLabel {
  key: string;
  anchorId: number; // the dot this label names (for a group: its outermost member)
  kind: 'phase' | 'group';
  text: string;
  x: number; // text anchor, middle
  y: number; // baseline
}

export interface HillLayout {
  dots: HillDot[]; // in draw order: lower levels first, so a stack shingles upward
  labels: HillLabel[];
  viewBox: string;
}

export interface HillLayoutOptions {
  /** viewBox width; the hill's 200-unit base space is scaled to fit it. */
  width: number;
  /** dot-label font size, in viewBox units. */
  fontSize: number;
  /** axis-caption font size — the captions are keep-out boxes, not decoration. */
  axisFontSize: number;
  /** visible coin radius, in viewBox units. Everything dot-shaped (blob distance,
   *  stack pitch, stack height) is a multiple of it, so the caller changes the ink
   *  scale with ONE number and gets the same drawing at another size. */
  dotRadius: number;
  /** radius of the invisible touch target on an uncrowded dot. This is a FINGER
   *  measurement, not ink, so it does NOT scale with `dotRadius`. */
  hitRadius: number;
  /** localized status word for a collapsed stack ("Done", "Not Started", …). */
  statusLabel: (status: HillStatus) => string;
  /** the two axis captions, needed only so labels never land on top of them. */
  axisLabels: { left: string; right: string };
}

const BASE_WIDTH = 200; // lib/geometry's coordinate space
const BASE_HEIGHT = 104;
const AXIS_BASELINE = 99; // y of the axis captions in the base space

/** The coin radius every dot-shaped measure below was tuned against — the narrow
 *  PhaseHillChart's own. They are stated as ratios of it, so a caller that
 *  passes a smaller `dotRadius` gets the SAME picture at a smaller size rather than
 *  a differently-proportioned one (design.md §8c: one drawing, two sizes). */
const BASE_DOT_R = 5.5;
/** Centre distance below which two dots read as one blob (2r + the paper ring). */
const MIN_DX_R = 13 / BASE_DOT_R;
/** Preferred height of the tallest stack; the pitch shrinks to stay inside it. */
const STACK_BUDGET_R = 34 / BASE_DOT_R;
const PITCH_MIN_R = 3.6 / BASE_DOT_R; // below this the coins stop being countable
const PITCH_MAX_R = 7 / BASE_DOT_R;
/** Dots above this line fan DOWNWARD (there is no room above the crest). */
const FAN_DOWN_ABOVE_Y = 40;
/** A lone dot this close to the top labels below itself instead of above. */
const LABEL_BELOW_ABOVE_Y = 22;

/** Same idea for the label metrics: every clearance is a multiple of the type it
 *  separates, so shrinking the type shrinks the whitespace with it instead of
 *  stranding a label three rows away from the dot it names. */
const BASE_FS = 8;
const ROW_EM = 11 / BASE_FS; // vertical step between stacked label rows
const LABEL_GAP_EM = 3.5 / BASE_FS; // clear space between a dot's rim and its label
const EXTRA_ROWS = 3; // how far a label may retreat before it is dropped
const PAD_X = 2; // keep-in margin at the left/right viewBox edges
/** Horizontal clearance. ~3 space-widths at the label size: at 0.5em two labels on
 *  one row rendered as a single run of text with a hairline between them. */
const GAP_X_EM = 7 / BASE_FS;
/** Vertical clearance. Generous on purpose: the cap-height box below understates a
 *  line's real ink (ascenders, descenders), and two labels an eighth of an em apart
 *  READ as touching. Must stay under ROW_EM so stacked rows still pass. */
const GAP_Y_EM = 2.5 / BASE_FS;
const CAP = 0.78; // cap height / font size — the label box's rise above its baseline
const DESC = 0.22;
/** Dots are keep-out boxes for labels, but only their solid core: a label may sit in
 *  the antialiased edge without reading as an overprint. */
const DOT_OBSTACLE_SCALE = 0.85;
/** Longest a label may be, as a fraction of the chart width. */
const LABEL_WIDTH_RATIO = 0.34;

const NARROW_CHAR = 0.55; // average advance / font size for latin text at weight 600
const WIDE_CHAR = 1; // CJK glyphs are square — ja/ko labels are ~2x a latin count
const CJK_MIN = 0x2e80;
const EPS = 0.01;

interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round2 = (v: number) => Math.round(v * 100) / 100;

/** Centre-to-centre distance from `dots[i]` to its closest neighbour, or Infinity when
 *  it is the only dot. O(n²) over a handful of phases, which is cheaper than the
 *  bookkeeping a spatial index would need here. */
const nearestDotDistance = (dots: { x: number; y: number }[], i: number): number => {
  let nearest = Infinity;
  for (let j = 0; j < dots.length; j += 1) {
    if (j !== i) nearest = Math.min(nearest, Math.hypot(dots[j].x - dots[i].x, dots[j].y - dots[i].y));
  }
  return nearest;
};

/** Deterministic width estimate — DOM measurement would be a browser-only read, and
 *  this chart renders on the server first. Counts CJK as double-width (the char-count
 *  cap it replaces truncated ja/ko labels to half the intended box). */
export function hillTextWidth(text: string, fontSize: number): number {
  let units = 0;
  for (const ch of text) units += (ch.codePointAt(0) ?? 0) >= CJK_MIN ? WIDE_CHAR : NARROW_CHAR;
  return units * fontSize;
}

/** Truncate by estimated WIDTH, not character count, so every locale gets the same box. */
export function truncateToWidth(text: string, fontSize: number, maxWidth: number): string {
  if (hillTextWidth(text, fontSize) <= maxWidth) return text;
  const ellipsis = hillTextWidth('…', fontSize);
  let out = '';
  let w = 0;
  for (const ch of text) {
    const cw = hillTextWidth(ch, fontSize);
    if (w + cw + ellipsis > maxWidth) break;
    out += ch;
    w += cw;
  }
  return `${out.trimEnd()}…`;
}

export function hillStatusOf(progress: number): HillStatus {
  if (progress <= 0) return 'notStarted';
  if (progress >= 100) return 'done';
  return 'inProgress';
}

const overlapsY = (a: Box, b: Box, gapY: number) => a.y0 < b.y1 + gapY && b.y0 < a.y1 + gapY;

/**
 * Nearest x to `anchorX` at which a `2*halfW`-wide label fits inside [0, width] without
 * touching any blocked box. Solved as a 1-D interval problem: each obstacle forbids a
 * span of CENTRES, and the answer is either the anchor itself or the nearest edge of a
 * forbidden span. Returns null when the label cannot fit anywhere on this row.
 * `gapX` is the horizontal clearance, which scales with the label's own type size.
 */
export function freeLabelCenter(
  anchorX: number,
  halfW: number,
  blocked: Box[],
  width: number,
  gapX: number,
): number | null {
  const lo = PAD_X + halfW;
  const hi = width - PAD_X - halfW;
  if (lo > hi) return null;
  const spans = blocked
    .map((b): [number, number] => [b.x0 - halfW - gapX, b.x1 + halfW + gapX])
    .sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
    else merged.push([span[0], span[1]]);
  }
  const forbidden = (c: number) => merged.some(([a, b]) => c > a + EPS && c < b - EPS);
  const candidates = [clamp(anchorX, lo, hi)];
  for (const [a, b] of merged) candidates.push(clamp(a, lo, hi), clamp(b, lo, hi));
  let best: number | null = null;
  for (const c of candidates) {
    if (forbidden(c)) continue;
    if (best === null || Math.abs(c - anchorX) < Math.abs(best - anchorX)) best = c;
  }
  return best;
}

interface Anchored {
  phase: HillPhase;
  index: number;
  x: number;
  baseY: number;
  status: HillStatus;
}

/** Swarm packing: the lowest level on which this dot clears every dot already there. */
function assignLevels(sorted: Anchored[], minDx: number): Map<number, number> {
  const lanes: number[][] = [];
  const level = new Map<number, number>();
  for (const a of sorted) {
    let k = 0;
    for (;;) {
      const lane = lanes[k];
      const last = lane?.[lane.length - 1];
      if (last === undefined || a.x - last >= minDx) break;
      k += 1;
    }
    (lanes[k] ??= []).push(a.x);
    level.set(a.index, k);
  }
  return level;
}

interface Candidate {
  priority: number; // 0 = in progress, 1 = everything else
  kind: 'phase' | 'group';
  key: string;
  text: string;
  anchor: HillDot;
  baseY: number;
  stacked: boolean; // anchor is the outer end of a stack — only label outward from it
}

export function layoutHill(phases: HillPhase[], opts: HillLayoutOptions): HillLayout {
  const { width, fontSize: fs, axisFontSize, dotRadius: r, hitRadius, statusLabel, axisLabels } = opts;
  const sx = width / BASE_WIDTH;
  const maxLabelWidth = width * LABEL_WIDTH_RATIO;
  // Derived once: everything dot-shaped scales with the coin, everything label-shaped
  // with the type. Nothing here is an absolute unit count any more.
  const minDx = r * MIN_DX_R;
  const rowStep = fs * ROW_EM;
  const labelGap = fs * LABEL_GAP_EM;
  const gapX = fs * GAP_X_EM;
  const gapY = fs * GAP_Y_EM;

  const anchored: Anchored[] = phases.map((phase, index) => {
    const c = hillCoordinates(phase.progress);
    return { phase, index, x: c.x * sx, baseY: c.y, status: hillStatusOf(phase.progress) };
  });
  // Ties break on input order, never on identity, so the layout is stable across renders.
  const byX = [...anchored].sort((a, b) => a.x - b.x || a.index - b.index);
  const levels = assignLevels(byX, minDx);
  const maxLevel = Math.max(0, ...levels.values());
  const pitch =
    maxLevel === 0
      ? 0
      : clamp((r * STACK_BUDGET_R) / maxLevel, r * PITCH_MIN_R, r * PITCH_MAX_R);

  const placed = byX.map((a) => {
    const level = levels.get(a.index) ?? 0;
    // Fan away from the crest: at the ends there is no room below (axis captions), at
    // the crest none above. Both directions stay inside the drawing either way.
    const dir = a.baseY < FAN_DOWN_ABOVE_Y ? 1 : -1;
    return {
      id: a.phase.id,
      name: a.phase.name,
      progress: a.phase.progress,
      status: a.status,
      x: round2(a.x),
      y: round2(a.baseY + dir * level * pitch),
      // Rounded here, before hitR is floored against it, so the rounding can never
      // put the target a hundredth of a unit inside its own coin.
      r: round2(r),
      level,
    };
  });

  // TOUCH TARGETS. Two rules, in this order:
  //   1. never smaller than the coin you can see — a target inside its own dot is a
  //      dot that looks clickable where it is not, and that is what a stack used to
  //      produce (the target shrank to the pitch, which is BELOW the radius once a
  //      stack is deep enough);
  //   2. never more than half the way to the nearest neighbour, so no two targets
  //      overlap and every dot keeps an exclusive area to hover.
  // Where the two disagree — a shingled stack, whose coins are closer together than
  // their own diameter — rule 1 wins and the targets overlap exactly as much as the
  // coins do. The dots draw level 0 first, so the coin on TOP is also the target on
  // top: what you see is what you hit. The cap is the caller's `hitRadius`, a finger
  // measurement that stays put when the ink scales.
  const dotsByX: HillDot[] = placed.map((d, i) => ({
    ...d,
    // Written floor-outside-ceiling so rule 1 beating rule 2 is legible here, rather
    // than depending on the argument order of `clamp`.
    hitR: round2(Math.max(d.r, Math.min(nearestDotDistance(placed, i) / 2, hitRadius))),
  }));
  const baseYById = new Map(byX.map((a) => [a.phase.id, a.baseY]));

  // Same-status neighbours collapse into one label. Grouping is bounded by the first
  // member's x (not chained), so an evenly-spread run can never swallow the whole chart.
  const groups: HillDot[][] = [];
  for (const d of dotsByX) {
    const g = groups[groups.length - 1];
    if (g && g[0].status === d.status && d.x - g[0].x < minDx) g.push(d);
    else groups.push([d]);
  }

  const candidates: Candidate[] = [];
  for (const g of groups) {
    // In-progress phases never collapse: the name of the thing being worked on IS the
    // information, so they each get their own label and first pick of the space.
    if (g[0].status === 'inProgress' || g.length === 1) {
      for (const d of g) {
        candidates.push({
          priority: d.status === 'inProgress' ? 0 : 1,
          kind: 'phase',
          key: `p${d.id}`,
          text: truncateToWidth(d.name, fs, maxLabelWidth),
          anchor: d,
          baseY: baseYById.get(d.id) ?? d.y,
          stacked: g.length > 1,
        });
      }
      continue;
    }
    const outer = g.reduce((a, b) => (b.level > a.level ? b : a));
    candidates.push({
      priority: 1,
      kind: 'group',
      key: `g${outer.id}`,
      text: truncateToWidth(statusLabel(g[0].status), fs, maxLabelWidth),
      anchor: outer,
      baseY: baseYById.get(outer.id) ?? outer.y,
      stacked: true,
    });
  }
  candidates.sort(
    (a, b) => a.priority - b.priority || a.anchor.x - b.anchor.x || a.anchor.id - b.anchor.id,
  );

  // Keep-out boxes: the axis captions (fixed furniture) and every dot glyph.
  const captionBox = (text: string, cx: number): Box => {
    const hw = hillTextWidth(text, axisFontSize) / 2;
    return {
      x0: cx - hw,
      x1: cx + hw,
      y0: AXIS_BASELINE - axisFontSize * CAP,
      y1: AXIS_BASELINE + axisFontSize * DESC,
    };
  };
  const obstacles: Box[] = [
    captionBox(axisLabels.left, 50 * sx),
    captionBox(axisLabels.right, 150 * sx),
    ...dotsByX.map((d) => ({
      x0: d.x - d.r * DOT_OBSTACLE_SCALE,
      x1: d.x + d.r * DOT_OBSTACLE_SCALE,
      y0: d.y - d.r * DOT_OBSTACLE_SCALE,
      y1: d.y + d.r * DOT_OBSTACLE_SCALE,
    })),
  ];

  const labels: HillLabel[] = [];
  const labelBoxes: Box[] = [];
  for (const cand of candidates) {
    const halfW = hillTextWidth(cand.text, fs) / 2;
    const a = cand.anchor;
    // Outward = away from the stack, so a collapsed stack's label sits beyond its last
    // coin rather than inside the pile. A lone dot may also use the far side.
    const flipY = cand.stacked ? FAN_DOWN_ABOVE_Y : LABEL_BELOW_ABOVE_Y;
    const outward = cand.baseY < flipY ? 1 : -1;
    const row = (n: number) =>
      outward < 0
        ? a.y - a.r - labelGap - n * rowStep
        : a.y + a.r + labelGap + fs * CAP + n * rowStep;
    const inward = outward < 0 ? a.y + a.r + labelGap + fs * CAP : a.y - a.r - labelGap;
    const slots = [row(0)];
    if (!cand.stacked) slots.push(inward);
    for (let n = 1; n <= EXTRA_ROWS; n += 1) slots.push(row(n));

    for (const y of slots) {
      const band: Box = { x0: 0, x1: width, y0: y - fs * CAP, y1: y + fs * DESC };
      if (band.y1 > BASE_HEIGHT) continue; // below the drawing is off the chart, not just off-grid
      const blocked = [...obstacles, ...labelBoxes].filter((b) => overlapsY(band, b, gapY));
      const x = freeLabelCenter(a.x, halfW, blocked, width, gapX);
      if (x === null) continue;
      labels.push({
        key: cand.key,
        anchorId: a.id,
        kind: cand.kind,
        text: cand.text,
        x: round2(x),
        y: round2(y),
      });
      labelBoxes.push({ x0: x - halfW, x1: x + halfW, y0: band.y0, y1: band.y1 });
      break;
    }
  }

  // Derive the viewBox from what was actually drawn: a tall stack or a high label
  // extends the box instead of being cropped by it.
  let minY = 0;
  let maxY = BASE_HEIGHT;
  for (const d of dotsByX) {
    minY = Math.min(minY, d.y - d.r);
    maxY = Math.max(maxY, d.y + d.r);
  }
  for (const l of labels) {
    minY = Math.min(minY, l.y - fs * CAP);
    maxY = Math.max(maxY, l.y + fs * DESC);
  }
  minY = round2(Math.floor(minY - 1));
  maxY = round2(Math.ceil(maxY + 1));

  return {
    // Draw order, not read order: level 0 first so a stack shingles upward and the
    // outermost coin — the one the label points at — sits on top.
    dots: [...dotsByX].sort((a, b) => a.level - b.level || a.x - b.x || a.id - b.id),
    labels,
    viewBox: `0 ${minY} ${round2(width)} ${round2(maxY - minY)}`,
  };
}
