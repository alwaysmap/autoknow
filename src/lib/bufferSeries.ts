// The program buffer as ONE value per day — the data behind the two-tone buffer
// flow (issue #161, decisions 2/3/5). Pure and client-safe, like lib/chainLedger,
// which stays the only place the buffer arithmetic itself lives.
//
// The stepped lane this replaces walked a hand-built event list inside the
// component (ChainSchedule.tsx). Moving that walk here buys two things the lane
// could not have:
//   • ONE SET OF BOOKS, now literally. The moves below apply the SAME five predicates
//     `computeChainLedger` builds its waterfall from — imported, not copied, since
//     autoknow-4dr.1. Two things hold the books together and neither is vigilance:
//     the predicates are one definition, and `netDays` must still equal
//     `ledger.usedDays` (tests/bufferSeries.test.ts). The second gate keeps its job
//     even so — sharing the predicates makes the two files agree on WHICH rows moved
//     the buffer, never on how many days each move is worth or when it lands, which
//     is the arithmetic below and is exactly what the balance test measures.
//   • A SLOPE WHERE THE LOSS WAS GRADUAL. A day of idle handoff costs a day of
//     buffer, every day it lasts; a phase past its plan tick spends a day per day
//     it keeps running. Those are RAMPS across their window, not cliffs at one end
//     of it — a per-day series can say that, a stepped lane could not.
//
// Nothing here clips. `leftPct` goes above 100 when a phase hands back more than
// the program started with, and below 0 when the buffer is blown; the renderer
// derives its y-axis from the values it is handed (decision 3).

import {
  hasIdleGapBefore, isRealizedOverrun, isRealizedUnderrun, isForecastOver, isForecastUnder,
} from './chainLedger';
import type { ChainLedgerResult, ScheduleRow } from './chainLedger';
import { DAY_MS, dayFloor } from './sop';

/**
 * A dated change to the buffer, signed in BUFFER terms: negative spends it,
 * positive hands days back. `fromMs`/`toMs` are the window it accrues over —
 * equal for a move that lands all at once.
 */
export interface BufferMove {
  kind: 'gap' | 'overrun' | 'underrun' | 'forecast';
  days: number;
  fromMs: number;
  toMs: number;
  projected: boolean; // a claim about days not yet spent
  phaseId?: number;
  fromId?: number; // gap only: the phase that handed the baton over
  toId?: number; // gap only: the phase that picked it up
}

/** The buffer on one day. `ms` is that day's UTC midnight. */
export interface BufferPoint {
  ms: number;
  leftDays: number; // buffer in hand — negative once it is blown
  leftPct: number; // share of B₀ — over 100 and under 0 are both real
  projected: boolean; // strictly after today: the forecast continuation
}

export interface BufferSeriesResult {
  points: BufferPoint[];
  /** B₀ — the buffer the SOP implied when the program's first phase started. */
  startBufferDays: number;
  /** Every move, in date order, so a summary can name what a step was. */
  moves: BufferMove[];
  /** Buffer spent across the whole book as of `now`, forecast tail included. */
  netDays: number;
  /**
   * `ledger.usedDays` − `netDays`: buffer the walk cannot point at. Reported,
   * NEVER folded into the points — a flow that silently reconciles itself to the
   * headline number is exactly the flow that cannot tell you the books are off.
   * (The waterfall keeps its own copy of this as an `unattributed` row and drops it
   * below ±2 days as rounding drift — `chainLedger.ts:304`, a bare literal that
   * happens to equal FORECAST_NOISE_DAYS but is not derived from it, so tuning that
   * constant would not move this threshold.)
   */
  unattributedDays: number;
}


/**
 * The moves, derived from the schedule rows with the waterfall's own predicates.
 * Windows are chosen so each move accrues WHERE IT IS SPENT:
 *   • gap / overrun ramp across the days that leak — during an idle handoff or a
 *     phase running past its plan tick, the projected finish moves out day by day.
 *   • an underrun lands whole at the actual end: the successor can start that day,
 *     so the projected finish jumps in at once.
 *   • a FORECAST move is drawn past today, never all at `now` (decision 5) — the
 *     claim is that those days will be spent between the plan tick and the
 *     projected end, and hiding the draw in the past would make the flow look
 *     healthier at today than the program's own next-steps list says it is.
 */
function movesOf(schedule: ScheduleRow[], now: number): BufferMove[] {
  const moves: BufferMove[] = [];
  for (let i = 0; i < schedule.length; i++) {
    const r = schedule[i];
    const prev = schedule[i - 1];
    if (hasIdleGapBefore(r) && prev) {
      moves.push({ kind: 'gap', days: -r.gapBeforeDays, fromMs: prev.endMs, toMs: r.startMs, projected: false, fromId: prev.id, toId: r.id });
    }
    if (isRealizedOverrun(r)) {
      moves.push({ kind: 'overrun', days: -r.varianceDays, fromMs: r.plannedEndMs, toMs: r.endMs, projected: false, phaseId: r.id });
    }
    if (isRealizedUnderrun(r)) {
      moves.push({ kind: 'underrun', days: -r.varianceDays, fromMs: r.endMs, toMs: r.endMs, projected: false, phaseId: r.id });
    }
    if (isForecastOver(r)) {
      const fromMs = Math.max(now, r.plannedEndMs);
      moves.push({ kind: 'forecast', days: -r.varianceDays, fromMs, toMs: Math.max(fromMs, r.endMs), projected: true, phaseId: r.id });
    }
    if (isForecastUnder(r)) {
      const at = Math.max(now, r.endMs);
      moves.push({ kind: 'forecast', days: -r.varianceDays, fromMs: at, toMs: at, projected: true, phaseId: r.id });
    }
  }
  moves.sort((a, b) => a.fromMs - b.fromMs || a.toMs - b.toMs);
  return moves;
}

/** How much of `m` has accrued by the end of the day starting at `dayMs`. */
function accrued(m: BufferMove, dayMs: number): number {
  const at = dayMs + DAY_MS;
  if (m.toMs <= m.fromMs) return at > m.fromMs ? m.days : 0;
  if (at <= m.fromMs) return 0;
  if (at >= m.toMs) return m.days;
  return (m.days * (at - m.fromMs)) / (m.toMs - m.fromMs);
}

/**
 * The buffer, one value per day, from the chain's first start to the projected
 * finish (or to today, whichever is later).
 *
 * Returns null when there is no percentage story to tell: no SOP, an empty chain,
 * or a program that started with B₀ ≤ 0 days of buffer — "share of nothing" has no
 * value, and a flow drawn against it would be inventing its own frame. Callers
 * degrade with an honest message rather than rendering a lie (AGENTS lesson 5).
 */
export function bufferSeries(ledger: ChainLedgerResult, now: number): BufferSeriesResult | null {
  const { schedule, startBufferDays, usedDays } = ledger;
  if (schedule.length === 0 || startBufferDays == null || startBufferDays <= 0 || usedDays == null) return null;

  const moves = movesOf(schedule, now);
  // Accumulated as `0 − days` rather than negating the sum: with no moves at all,
  // negating yields -0. Checked rather than assumed — String(), template literals,
  // toFixed() and JSON.stringify() all print "0"; the only formatter that surfaces
  // "-0" is Intl.NumberFormat, which no Chain component uses today. So this costs
  // nothing and closes the one door (that, and `Object.is` in a future test).
  const netDays = moves.reduce((sum, m) => sum - m.days, 0);

  const firstMs = dayFloor(Math.min(...schedule.map((r) => r.startMs)));
  const lastMs = dayFloor(
    Math.max(now, ledger.projectedFinishMs ?? now, ...moves.map((m) => m.toMs)),
  );
  const todayMs = dayFloor(now);

  const points: BufferPoint[] = [];
  for (let ms = firstMs; ms <= lastMs; ms += DAY_MS) {
    const leftDays = moves.reduce((left, m) => left + accrued(m, ms), startBufferDays);
    points.push({ ms, leftDays, leftPct: (leftDays * 100) / startBufferDays, projected: ms > todayMs });
  }

  return { points, startBufferDays, moves, netDays, unattributedDays: usedDays - netDays };
}
