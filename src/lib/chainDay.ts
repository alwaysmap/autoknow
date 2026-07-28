// What the whole chain was doing on ONE day — the data behind the docked day
// summary (issue #161, decision 4). Pure and client-safe; the strip is a dumb
// renderer over this, and every sentence it shows is built from lib/i18n over
// these structured facts, never from prose produced here.
//
// The hover this replaces answered "what is the row under the pointer" — a row.
// The question the chart exists for is "what was EVERYTHING doing on this day",
// which is a column: every phase the day selector crosses, plus the two things
// that are not phases and still cost buffer — the credit window a phase opened by
// finishing early, and the idle gap between a baton landing and being picked up.

import { hasIdleGapBefore, isForecastOver, isRealizedOverrun, isRealizedUnderrun } from './chainLedger';
import type { ScheduleRow } from './chainLedger';
import { DAY_MS, dayFloor } from './sop';

/**
 * What a phase was doing on the day — the Option A marks, named. `over` is the
 * fact you act on: days past the phase's OWN estimate, realized. `forecastOver`
 * is the same claim about days not yet spent.
 */
export type DayPhaseState = 'done' | 'elapsed' | 'over' | 'forecast' | 'forecastOver' | 'scheduled';

export interface DayPhase {
  row: ScheduleRow;
  state: DayPhaseState;
  dayIndex: number; // 1-based day within the phase's own span
  spanDays: number; // the phase's whole span, in days
}

/** An idle handoff the day falls inside: the baton landed and nobody picked it up. */
export interface DayGap {
  fromId: number;
  toId: number;
  days: number;
  fromMs: number;
  toMs: number;
}

/** A credit window: a phase finished early, so these days were handed back. */
export interface DayCredit {
  phaseId: number;
  days: number;
  fromMs: number; // the actual end
  toMs: number; // the plan tick it beat
}

export interface DaySummary {
  dayMs: number; // normalized to UTC midnight
  projected: boolean; // strictly after today — everything below is a forecast
  phases: DayPhase[]; // chain order, so the strip reads top-to-bottom like the chart
  gaps: DayGap[];
  credits: DayCredit[];
}


/**
 * One state sub-span of a phase's bar. NOT named `Span`: `lib/focusWindow` already
 * exports that name for a `{ min, max }` viewport, and `ChainSchedule.tsx` — the
 * component step 2 wires `phaseDaySpans` into — already imports it. Two `Span`s in
 * one file would be an import alias on day one.
 */
export interface PhaseSpan {
  state: DayPhaseState;
  fromMs: number;
  toMs: number;
}

/**
 * A row's state sub-spans — the decomposition the Option A bar draws. Note what is
 * NOT here: the days a phase handed back are not part of the phase (it is over),
 * they are a credit window, and they come back from `summaryAt` as one.
 *
 * Its `active` branch decides the forecast question through `isForecastOver`; its
 * `done` branch decides the realized one through `isRealizedOverrun`, so neither
 * branch can name a day differently from the surfaces that share the predicate.
 */
export function phaseDaySpans(r: ScheduleRow, now: number): PhaseSpan[] {
  const out: PhaseSpan[] = [];
  const push = (state: DayPhaseState, fromMs: number, toMs: number) => {
    if (toMs > fromMs) out.push({ state, fromMs, toMs });
  };
  if (r.kind === 'done') {
    push('done', r.startMs, Math.min(r.endMs, r.plannedEndMs));
    // Gated on isRealizedOverrun (a whole-day test), not raw millisecond overrun:
    // every other surface calls a sub-day overrun "on plan", and the strip must
    // agree. NOT the same as the `active` branch's `over` push below, which is
    // bounded by `now` and reports days genuinely already elapsed past the tick —
    // a realized fact with no whole-day predicate over it.
    if (isRealizedOverrun(r)) push('over', r.plannedEndMs, r.endMs);
    return out;
  }
  if (r.kind === 'active') {
    push('elapsed', r.startMs, Math.min(now, r.plannedEndMs));
    push('over', r.plannedEndMs, now); // already past its estimate, and still running
    push('forecast', now, Math.min(r.endMs, r.plannedEndMs));
    push(isForecastOver(r) ? 'forecastOver' : 'forecast', Math.max(now, r.plannedEndMs), r.endMs);
    return out;
  }
  push('scheduled', r.startMs, r.endMs);
  return out;
}

/** How much of [fromMs, toMs) the day starting at `dayMs` covers. */
const overlap = (dayMs: number, fromMs: number, toMs: number) =>
  Math.min(dayMs + DAY_MS, toMs) - Math.max(dayMs, fromMs);

/** The state a day belongs to when it straddles two of one phase's spans: the
 *  larger overlap, ties to the LATER span, because the fact worth surfacing is
 *  the one the phase moved INTO. */
function dominantSpan(r: ScheduleRow, dayMs: number, now: number): PhaseSpan | null {
  let best: PhaseSpan | null = null;
  let bestOverlapMs = 0;
  for (const span of phaseDaySpans(r, now)) {
    const overlapMs = overlap(dayMs, span.fromMs, span.toMs);
    if (overlapMs > 0 && overlapMs >= bestOverlapMs) {
      best = span;
      bestOverlapMs = overlapMs;
    }
  }
  return best;
}

/**
 * Everything in flight on `atMs`, for the chain rows `rows` as of `now`.
 *
 * A day is crossed when it OVERLAPS a span at all, so a phase that starts at noon
 * still owns that day.
 */
export function summaryAt(rows: ScheduleRow[], atMs: number, now: number): DaySummary {
  const day = dayFloor(atMs);
  const phases: DayPhase[] = [];
  const gaps: DayGap[] = [];
  const credits: DayCredit[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const prev = rows[i - 1];
    if (hasIdleGapBefore(r) && prev && overlap(day, prev.endMs, r.startMs) > 0) {
      gaps.push({ fromId: prev.id, toId: r.id, days: r.gapBeforeDays, fromMs: prev.endMs, toMs: r.startMs });
    }
    if (isRealizedUnderrun(r) && overlap(day, r.endMs, r.plannedEndMs) > 0) {
      credits.push({ phaseId: r.id, days: -r.varianceDays, fromMs: r.endMs, toMs: r.plannedEndMs });
    }

    const dominant = dominantSpan(r, day, now);
    if (!dominant) continue;
    phases.push({
      row: r,
      state: dominant.state,
      dayIndex: Math.floor((day - dayFloor(r.startMs)) / DAY_MS) + 1,
      spanDays: Math.max(1, Math.round((r.endMs - r.startMs) / DAY_MS)),
    });
  }

  return { dayMs: day, projected: day > dayFloor(now), phases, gaps, credits };
}
