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
  hitR: number; // invisible touch target; shrinks in a stack so neighbours stay reachable
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
  /** radius of the invisible touch target on an uncrowded dot. */
  hitRadius: number;
  /** localized status word for a collapsed stack ("Done", "Not Started", …). */
  statusLabel: (status: HillStatus) => string;
  /** the two axis captions, needed only so labels never land on top of them. */
  axisLabels: { left: string; right: string };
}

const BASE_WIDTH = 200; // lib/geometry's coordinate space
const BASE_HEIGHT = 104;
const AXIS_BASELINE = 99; // y of the axis captions in the base space

const DOT_R = 5.5;
/** Centre distance below which two dots read as one blob (2r + the paper ring). */
const MIN_DX = 13;
/** Preferred height of the tallest stack; the pitch shrinks to stay inside it. */
const STACK_BUDGET = 34;
const PITCH_MIN = 3.6; // below this the coins stop being countable
const PITCH_MAX = 7;
/** Dots above this line fan DOWNWARD (there is no room above the crest). */
const FAN_DOWN_ABOVE_Y = 40;
/** A lone dot this close to the top labels below itself instead of above. */
const LABEL_BELOW_ABOVE_Y = 22;

const ROW = 11; // vertical step between stacked label rows
const LABEL_GAP = 3.5; // clear space between a dot's rim and its label
const EXTRA_ROWS = 3; // how far a label may retreat before it is dropped
const PAD_X = 2; // keep-in margin at the left/right viewBox edges
/** Horizontal clearance. ~3 space-widths at the label size: at 4 units two labels on
 *  one row rendered as a single run of text with a hairline between them. */
const GAP_X = 7;
/** Vertical clearance. Generous on purpose: the cap-height box below understates a
 *  line's real ink (ascenders, descenders), and two labels 1 unit apart READ as
 *  touching. Must stay under ROW so deliberately stacked rows still pass. */
const GAP_Y = 2.5;
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

const overlapsY = (a: Box, b: Box) => a.y0 < b.y1 + GAP_Y && b.y0 < a.y1 + GAP_Y;

/**
 * Nearest x to `anchorX` at which a `2*halfW`-wide label fits inside [0, width] without
 * touching any blocked box. Solved as a 1-D interval problem: each obstacle forbids a
 * span of CENTRES, and the answer is either the anchor itself or the nearest edge of a
 * forbidden span. Returns null when the label cannot fit anywhere on this row.
 */
export function freeLabelCenter(
  anchorX: number,
  halfW: number,
  blocked: Box[],
  width: number,
): number | null {
  const lo = PAD_X + halfW;
  const hi = width - PAD_X - halfW;
  if (lo > hi) return null;
  const spans = blocked
    .map((b): [number, number] => [b.x0 - halfW - GAP_X, b.x1 + halfW + GAP_X])
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
function assignLevels(sorted: Anchored[]): Map<number, number> {
  const lanes: number[][] = [];
  const level = new Map<number, number>();
  for (const a of sorted) {
    let k = 0;
    for (;;) {
      const lane = lanes[k];
      const last = lane?.[lane.length - 1];
      if (last === undefined || a.x - last >= MIN_DX) break;
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
  const { width, fontSize: fs, axisFontSize, hitRadius, statusLabel, axisLabels } = opts;
  const sx = width / BASE_WIDTH;
  const maxLabelWidth = width * LABEL_WIDTH_RATIO;

  const anchored: Anchored[] = phases.map((phase, index) => {
    const c = hillCoordinates(phase.progress);
    return { phase, index, x: c.x * sx, baseY: c.y, status: hillStatusOf(phase.progress) };
  });
  // Ties break on input order, never on identity, so the layout is stable across renders.
  const byX = [...anchored].sort((a, b) => a.x - b.x || a.index - b.index);
  const levels = assignLevels(byX);
  const maxLevel = Math.max(0, ...levels.values());
  const pitch = maxLevel === 0 ? 0 : clamp(STACK_BUDGET / maxLevel, PITCH_MIN, PITCH_MAX);

  const dotsByX: HillDot[] = byX.map((a, i) => {
    const level = levels.get(a.index) ?? 0;
    // Fan away from the crest: at the ends there is no room below (axis captions), at
    // the crest none above. Both directions stay inside the drawing either way.
    const dir = a.baseY < FAN_DOWN_ABOVE_Y ? 1 : -1;
    const crowded =
      (i > 0 && a.x - byX[i - 1].x < MIN_DX) || (i + 1 < byX.length && byX[i + 1].x - a.x < MIN_DX);
    return {
      id: a.phase.id,
      name: a.phase.name,
      progress: a.phase.progress,
      status: a.status,
      x: round2(a.x),
      y: round2(a.baseY + dir * level * pitch),
      r: DOT_R,
      // A full-size target on a shingled dot swallows its neighbours; shrink it to the
      // pitch so every dot in a stack keeps an exclusive strip to hover.
      hitR: round2(crowded ? Math.min(hitRadius, Math.max(2.5, pitch * 0.95)) : hitRadius),
      level,
    };
  });
  const baseYById = new Map(byX.map((a) => [a.phase.id, a.baseY]));

  // Same-status neighbours collapse into one label. Grouping is bounded by the first
  // member's x (not chained), so an evenly-spread run can never swallow the whole chart.
  const groups: HillDot[][] = [];
  for (const d of dotsByX) {
    const g = groups[groups.length - 1];
    if (g && g[0].status === d.status && d.x - g[0].x < MIN_DX) g.push(d);
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
        ? a.y - a.r - LABEL_GAP - n * ROW
        : a.y + a.r + LABEL_GAP + fs * CAP + n * ROW;
    const inward = outward < 0 ? a.y + a.r + LABEL_GAP + fs * CAP : a.y - a.r - LABEL_GAP;
    const slots = [row(0)];
    if (!cand.stacked) slots.push(inward);
    for (let n = 1; n <= EXTRA_ROWS; n += 1) slots.push(row(n));

    for (const y of slots) {
      const band: Box = { x0: 0, x1: width, y0: y - fs * CAP, y1: y + fs * DESC };
      if (band.y1 > BASE_HEIGHT) continue; // below the drawing is off the chart, not just off-grid
      const blocked = [...obstacles, ...labelBoxes].filter((b) => overlapsY(band, b));
      const x = freeLabelCenter(a.x, halfW, blocked, width);
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
