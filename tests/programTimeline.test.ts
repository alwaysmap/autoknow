/** @jest-environment node */
// The portfolio whisker chart's layout (#159). Pure, so these run without a DOM, a model or
// a database — and the properties they pin are the ones whose failure is SILENT: a mark
// placed in the wrong lane still renders, a program quietly dropped still leaves a chart
// that looks complete, and a forecast taken from the wrong source still draws a plausible
// whisker that contradicts the table three columns away.

import { buildTimelineMarks, monthTicks, type TimelineProgram } from '../src/lib/programTimeline';

const NOW = Date.UTC(2026, 5, 15); // 2026-06-15
const DAY = 86_400_000;

const prog = (over: Partial<TimelineProgram> & { id: number }): TimelineProgram => ({
  name: `P${over.id}`,
  theNeedle: 'On Track',
  sopDate: null,
  chainRemainingDays: 0,
  isArchived: false,
  lifecycle: 'active',
  hillChartProgress: 10,
  ...over,
});

describe('which programs get a mark', () => {
  it('plots a program with NO target SOP, without an SOP dot', () => {
    // The chart's job is showing everything in flight, and an undated program is still in
    // flight — arguably the one most worth seeing. Dropping it was the original spec and
    // was changed deliberately (2026-08-03).
    const { marks, excludedNoDates } = buildTimelineMarks(
      [prog({ id: 1, chainRemainingDays: 30 })], new Map(), NOW,
    );
    expect(marks).toHaveLength(1);
    expect(marks[0].sopMs).toBeNull();
    expect(marks[0].finishMs).toBe(NOW + 30 * DAY);
    expect(excludedNoDates).toBe(0);
  });

  it('excludes only a program carrying NO date at all, and counts it', () => {
    // Distinct from "no SOP": there is nowhere on a TIME axis to put a program with no
    // time on it. Counted rather than silently dropped.
    const { marks, excludedNoDates } = buildTimelineMarks([prog({ id: 1 })], new Map(), NOW);
    expect(marks).toHaveLength(0);
    expect(excludedNoDates).toBe(1);
  });

  it('gives a start dot only to a program the aggregate found a start for', () => {
    const started = Date.UTC(2026, 2, 1);
    const { marks } = buildTimelineMarks(
      [prog({ id: 1, sopDate: '2026-09-01' }), prog({ id: 2, sopDate: '2026-09-01' })],
      new Map([[1, started]]), NOW,
    );
    expect(marks.find((m) => m.id === 1)!.startMs).toBe(started);
    expect(marks.find((m) => m.id === 2)!.startMs).toBeNull();
  });
});

describe('the forecast finish', () => {
  it('is now + remaining chain days — the quantity the page\'s own SOP outlook column uses', () => {
    // NOT the ledger's cascade. The ledger is the better forecast and is what a program's
    // own page prints, but a chart using it would overshoot the SOP on a row whose outlook
    // cell says On track. One page must not contradict itself.
    const { marks } = buildTimelineMarks(
      [prog({ id: 1, sopDate: '2026-12-01', chainRemainingDays: 40 })], new Map(), NOW,
    );
    expect(marks[0].finishMs).toBe(NOW + 40 * DAY);
  });

  it('is absent for a program that is no longer Active', () => {
    // A Done or Cancelled program has no remaining chain, so a "forecast finish" would be
    // a date nobody is working toward — the same boundary sopBufferCategory applies.
    const { marks } = buildTimelineMarks(
      [prog({ id: 1, sopDate: '2026-12-01', chainRemainingDays: 40, lifecycle: 'cancelled' })],
      new Map(), NOW,
    );
    expect(marks[0].finishMs).toBeNull();
    expect(marks[0].sopMs).not.toBeNull(); // still plotted, still shows its target
  });

  it('is absent when nothing remains on the chain', () => {
    const { marks } = buildTimelineMarks(
      [prog({ id: 1, sopDate: '2026-12-01', chainRemainingDays: 0 })], new Map(), NOW,
    );
    expect(marks[0].finishMs).toBeNull();
  });
});

describe('the window', () => {
  it('always contains today, so the reader has an anchor for how far off the rest is', () => {
    const { windowMinMs, windowMaxMs } = buildTimelineMarks(
      [prog({ id: 1, sopDate: '2027-03-01' })], new Map(), NOW,
    );
    expect(windowMinMs).toBeLessThanOrEqual(NOW);
    expect(windowMaxMs).toBeGreaterThan(NOW);
  });

  it('snaps out to month boundaries at both ends', () => {
    const { windowMinMs, windowMaxMs } = buildTimelineMarks(
      [prog({ id: 1, sopDate: '2026-09-17' })], new Map([[1, Date.UTC(2026, 3, 20)]]), NOW,
    );
    expect(new Date(windowMinMs).getUTCDate()).toBe(1);
    expect(new Date(windowMaxMs).getUTCDate()).toBe(1);
    expect(windowMinMs).toBeLessThanOrEqual(Date.UTC(2026, 3, 20));
    expect(windowMaxMs).toBeGreaterThanOrEqual(Date.UTC(2026, 8, 17));
  });
});

describe('row order — most urgent first, one row per program', () => {
  // NOT lane packing. Packing put unrelated programs on one row whenever their dates did
  // not overlap, which made "soonest SOP at the top" impossible to say — a row was not a
  // program. One row per program is what lets the chart scroll honestly at portfolio scale
  // against an anchored axis.
  it('gives every program its own row', () => {
    const three = [1, 2, 3].map((id) => prog({ id, sopDate: '2026-09-01' }));
    const { marks, laneCount } = buildTimelineMarks(three, new Map(), NOW);
    expect(laneCount).toBe(3);
    expect(marks.map((m) => m.lane).sort()).toEqual([0, 1, 2]);
  });

  it('puts OVERRUNNING programs first, worst overrun at the top', () => {
    // The forecast landing after the SOP is the news the red segment exists for, so those
    // rows are the ones a reader sees without scrolling.
    const slightly = prog({ id: 1, sopDate: '2026-07-01', chainRemainingDays: 30 }); // ~2wk over
    const badly = prog({ id: 2, sopDate: '2026-07-01', chainRemainingDays: 200 });   // months over
    const fine = prog({ id: 3, sopDate: '2026-12-01', chainRemainingDays: 10 });
    const { marks } = buildTimelineMarks([fine, slightly, badly], new Map(), NOW);
    expect(marks.map((m) => m.id)).toEqual([2, 1, 3]);
  });

  it('orders the rest by soonest SOP — what lands next is what you plan around', () => {
    const later = prog({ id: 1, sopDate: '2027-01-01' });
    const sooner = prog({ id: 2, sopDate: '2026-08-01' });
    const { marks } = buildTimelineMarks([later, sooner], new Map(), NOW);
    expect(marks.map((m) => m.id)).toEqual([2, 1]);
  });

  it('puts programs with NO target SOP last, but still plots them', () => {
    // Last because there is no date to be urgent about — present because the chart's job is
    // everything in flight.
    const undated = prog({ id: 1, chainRemainingDays: 30 });
    const dated = prog({ id: 2, sopDate: '2027-01-01' });
    const { marks } = buildTimelineMarks([undated, dated], new Map(), NOW);
    expect(marks.map((m) => m.id)).toEqual([2, 1]);
    expect(marks.find((m) => m.id === 1)!.sopMs).toBeNull();
  });

  it('orders by the data, not by array position', () => {
    const a = prog({ id: 1, sopDate: '2026-07-01' });
    const b = prog({ id: 2, sopDate: '2026-08-01' });
    const forward = buildTimelineMarks([a, b], new Map(), NOW).marks.map((m) => [m.id, m.lane]);
    const reversed = buildTimelineMarks([b, a], new Map(), NOW).marks.map((m) => [m.id, m.lane]);
    expect(reversed).toEqual(forward);
  });
});

describe('monthTicks', () => {
  it('thins to at most `max`, so axis labels cannot collide', () => {
    const ticks = monthTicks(Date.UTC(2026, 0, 1), Date.UTC(2029, 0, 1), 8);
    expect(ticks.length).toBeLessThanOrEqual(8);
    expect(ticks.length).toBeGreaterThan(1);
  });

  it('returns every month when they already fit', () => {
    const ticks = monthTicks(Date.UTC(2026, 0, 1), Date.UTC(2026, 3, 1), 8);
    expect(ticks).toHaveLength(4);
  });

  it('does NOT always end on the window edge once it has thinned', () => {
    // The reason `ProgramTimeline`'s tick labels take their pull-back from their own
    // POSITION and never from `:last-child`. Thinning keeps every `step`-th month, so the
    // final tick lands on the edge only when the month count happens to divide. A
    // `:last-child { translateX(-100%) }` rule right-aligns the last label whatever its
    // position, which for these windows puts it half a label-width left of the date it
    // names — and it shipped that way on a 29-month view before anyone noticed.
    const off = [9, 11, 13, 16, 20].map((months) => {
      const min = Date.UTC(2026, 0, 1);
      const max = Date.UTC(2026, months, 1);
      const ticks = monthTicks(min, max, 8);
      return (ticks[ticks.length - 1] - min) / (max - min);
    });
    expect(off.every((f) => f < 0.95)).toBe(true);  // none of them reaches the edge
    expect(monthTicks(Date.UTC(2026, 0, 1), Date.UTC(2026, 24, 1), 8).at(-1))
      .toBe(Date.UTC(2026, 24, 1));                 // ...while others land exactly on it
  });
});
