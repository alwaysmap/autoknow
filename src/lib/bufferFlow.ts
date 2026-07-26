// The two-tone buffer flow's FRAME (issue #161, decision 3) — the y-axis derived
// at render time, and the one landmark the frame has to be able to show. Pure and
// client-safe, and deliberately separate from lib/bufferSeries: the series says
// what the buffer DID, this says what window you have to draw it in.
//
// The frame is derived from the values it must hold, never fixed. Clipping to a
// 0–100% box is a lie at BOTH ends: above 100% is real (a phase can hand back more
// than the program started with) and below 0% is the tail that matters most — the
// buffer is blown, and every further day is a day past the SOP. So the domain
// always CONTAINS 0 and 100 and always EXTENDS to whatever the data reached.
//
// It lives here rather than inline in ChainSchedule for the reason the stepped
// lane's `niceStep` did not: a scale that is a pure function of the numbers can be
// asserted against a crowding fixture (tests/bufferFlow.test.ts) — one that is
// computed halfway down a component can only be eyeballed.

import type { BufferPoint } from './bufferSeries';

export interface FlowScale {
  /** Domain, in percent of B₀. Contains 0 and 100; may run past either. */
  min: number;
  max: number;
  /** Spacing of the intermediate gridlines, in percent. */
  step: number;
  /** Gridline values, ascending. Always includes 0 and 100. */
  ticks: number[];
}

/** Candidate gridline spacings, in percent of B₀. Ordered, so the first one that
 *  keeps the axis under MAX_TICKS wins — a blown program can run to −300% and a
 *  10% stride would draw 40 gridlines through the reading. */
const STEPS = [10, 25, 50, 100, 250, 500, 1000];
const MAX_TICKS = 6;
/** Headroom past the extremes, so the flow never touches the frame's edge: 6% of
 *  the span, floored at 4 points for the calm case where the buffer barely moves. */
const PAD_FRACTION = 0.06;
const MIN_PAD = 4;

/**
 * The y-axis for a flow over `pcts` (each point's buffer left, in percent of B₀).
 *
 * 0 and 100 are always ticks even when the chosen stride would skip them: they are
 * not scale, they are the two facts the whole chart is about — the buffer the
 * program started with, and the moment it runs out.
 */
export function flowScale(pcts: number[]): FlowScale {
  const lo = Math.min(0, ...pcts);
  const hi = Math.max(100, ...pcts);
  const pad = Math.max(MIN_PAD, (hi - lo) * PAD_FRACTION);
  const min = lo - pad;
  const max = hi + pad;
  const step = STEPS.find((s) => (max - min) / s <= MAX_TICKS) ?? STEPS[STEPS.length - 1];
  const ticks = new Set<number>([0, 100]);
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) ticks.add(v);
  return { min, max, step, ticks: [...ticks].sort((a, b) => a - b) };
}

/**
 * The day the buffer ran out — the first point with nothing left — or null if it
 * never does. Marked on the flow because it is the one date on that axis anybody
 * acts on; it is routinely in the FORECAST tail, which is the point of drawing the
 * tail at all (decision 5).
 */
export function blownAt(points: BufferPoint[]): BufferPoint | null {
  return points.find((p) => p.leftDays <= 0) ?? null;
}
