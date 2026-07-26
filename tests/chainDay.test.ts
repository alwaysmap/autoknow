import { computeChainLedger, type ChainLedgerInput, type LedgerPhaseInput, type ScheduleRow } from '../src/lib/chainLedger';
import { summaryAt } from '../src/lib/chainDay';
import { bufferSeries } from '../src/lib/bufferSeries';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const D0 = Date.UTC(2026, 0, 1);
const day = (n: number) => D0 + n * DAY;
const iso = (n: number) => new Date(day(n)).toISOString();

const phase = (
  id: number,
  forecastedDuration: number,
  progress: number,
  parentIds: number[] = [],
  startedAt: string | null = null,
  completedAt: string | null = null,
): LedgerPhaseInput => ({ id, name: `P${id}`, forecastedDuration, progress, parentIds, startedAt, completedAt });

// A(30) done on day 27 (3 days early, so days 27–29 are a credit window)
// · idle days 27–32 · B(40) live since day 33, forecast 7 days over its plan tick
// on day 73 · C(30) queued from day 80. Clock at day 60.
const input: ChainLedgerInput = {
  phases: [
    phase(1, 30, 100, [], iso(0), iso(27)),
    phase(2, 40, 50, [1], iso(33)),
    phase(3, 30, 0, [2]),
  ],
  sopDate: iso(140),
  now: day(60),
};
const NOW = input.now;
const rows = computeChainLedger(input).schedule;
const at = (n: number) => summaryAt(rows, day(n), NOW);
const states = (n: number) => at(n).phases.map((p) => [p.row.id, p.state]);

describe('summaryAt — the column, not the row', () => {
  it('names the phase in flight and where the day sits in its span', () => {
    const s = at(50);
    expect(states(50)).toEqual([[2, 'elapsed']]);
    expect(s.phases[0].dayIndex).toBe(18); // day 33 is day 1
    expect(s.phases[0].spanDays).toBe(47); // day 33 → projected day 80
    expect(s.projected).toBe(false);
  });

  it('reports the credit window and the idle gap a day falls inside', () => {
    // Day 28 crosses no phase at all — A is finished and B has not started. The
    // whole answer for that day is the two things that are not phases.
    const s = at(28);
    expect(s.phases).toEqual([]);
    expect(s.credits).toEqual([{ phaseId: 1, days: 3, fromMs: day(27), toMs: day(30) }]);
    expect(s.gaps).toEqual([{ fromId: 1, toId: 2, days: 6, fromMs: day(27), toMs: day(33) }]);
  });

  it('closes the credit window and the gap at their real day boundaries', () => {
    expect(at(26).credits).toEqual([]); // A is still running
    expect(at(29).credits).toHaveLength(1); // last day before A's plan tick
    expect(at(30).credits).toEqual([]);
    expect(at(32).gaps).toHaveLength(1); // last idle day
    expect(at(33).gaps).toEqual([]); // B picks the baton up
  });

  it('separates a live phase into elapsed / forecast / forecast-over by the day', () => {
    expect(states(59)).toEqual([[2, 'elapsed']]);
    expect(states(60)).toEqual([[2, 'forecast']]); // today: the remainder starts here
    expect(states(72)).toEqual([[2, 'forecast']]); // still inside its own estimate
    expect(states(73)).toEqual([[2, 'forecastOver']]); // past the plan tick
    expect(at(73).projected).toBe(true);
  });

  it('carries the forecast tail past the last phase and past the SOP', () => {
    expect(states(85)).toEqual([[3, 'scheduled']]);
    expect(at(85).projected).toBe(true);
    expect(at(109).phases).toHaveLength(1); // last projected day of C
    expect(at(110).phases).toEqual([]); // the chain is over
  });

  it('normalizes a mid-day selector to its UTC day', () => {
    expect(summaryAt(rows, day(50) + 13 * HOUR, NOW).dayMs).toBe(day(50));
    expect(summaryAt(rows, day(50) + 13 * HOUR, NOW).phases).toEqual(at(50).phases);
  });
});

describe('summaryAt — the blown-buffer case', () => {
  // Same schedule, an SOP that the projection overshoots: the day summary must keep
  // describing days past the SOP exactly as before. The chart stops being pretty
  // there; it does not stop being true.
  const blown: ChainLedgerInput = { ...input, sopDate: iso(105) };
  const l = computeChainLedger(blown);
  const s = bufferSeries(l, NOW)!;

  it('still names what is in flight on days past the SOP', () => {
    expect(l.bufferDays).toBeLessThan(0);
    const past = summaryAt(l.schedule, day(108), NOW);
    expect(past.phases.map((p) => [p.row.id, p.state])).toEqual([[3, 'scheduled']]);
    expect(past.projected).toBe(true);
  });

  it('lines up day-for-day with a buffer that has gone negative', () => {
    const ranOut = s.points.find((p) => p.leftDays <= 0)!;
    const summary = summaryAt(l.schedule, ranOut.ms, NOW);
    // the buffer runs out inside B's forecast overrun — the phase to walk into
    expect(summary.phases.map((p) => [p.row.id, p.state])).toEqual([[2, 'forecastOver']]);
  });
});

describe('summaryAt — a day that straddles two of a phase’s own spans', () => {
  // A phase started at 06:00 has its plan tick at 06:00, so the day it passes that
  // tick is 6h of on-plan work and 18h of overrun. The state with the larger
  // overlap wins, so the day reads as the fact worth acting on.
  const straddle: ScheduleRow[] = [{
    id: 9, name: 'P9', kind: 'done',
    startMs: day(0) + 6 * HOUR, endMs: day(33),
    plannedEndMs: day(30) + 6 * HOUR, projected: false,
    varianceDays: 3, remainingDays: 0, gapBeforeDays: 0,
  }];

  it('gives the day to the span it covers most', () => {
    expect(summaryAt(straddle, day(29), NOW).phases[0].state).toBe('done');
    expect(summaryAt(straddle, day(30), NOW).phases[0].state).toBe('over');
    expect(summaryAt(straddle, day(32), NOW).phases[0].state).toBe('over');
  });
});
