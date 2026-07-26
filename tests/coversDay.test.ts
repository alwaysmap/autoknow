/** @jest-environment node */
// #127 E2a. "Which job is held today" was decided from `endDate == null`, which answers a
// different question — "is this period open-ended?" — and the two agree only while nothing
// is scheduled. Record a future-dated move and they split: today's period gains an endDate
// and looks like history, the scheduled one is open and looks current.
//
// These pin `coversDay` at the boundaries, because the boundaries are where the whole
// disagreement lives. A pure predicate over dates, so no database and no fixtures: the
// four-period career this exists to serve is asserted end-to-end in seedMock.test.ts.
import { coversDay } from '../src/lib/people';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const period = (start: string, end: string | null) => ({ startDate: d(start), endDate: end ? d(end) : null });

// The day every case below is asked about. Fixed, never `new Date()` — a predicate whose
// test drifts with the clock stops being a test on the day the clock crosses a boundary.
const TODAY = d('2026-07-26');

describe('coversDay — the period containing a day', () => {
  it('covers a day inside an open period', () => {
    expect(coversDay(period('2026-07-01', null), TODAY)).toBe(true);
  });

  it('covers a day inside a closed period', () => {
    expect(coversDay(period('2026-07-01', '2026-11-01'), TODAY)).toBe(true);
  });

  it('does not cover a day before the period starts — the scheduled move is the case', () => {
    // Alice's Honda period: recorded, not yet begun. Deciding on `endDate == null` calls
    // this one current, which is exactly the defect.
    expect(coversDay(period('2026-11-01', null), TODAY)).toBe(false);
  });

  it('does not cover a day after the period ended', () => {
    expect(coversDay(period('2024-03-01', '2026-07-01'), TODAY)).toBe(false);
  });

  // Half-open, `start <= t < end`: the two ends answer OPPOSITELY on their own date, which
  // is what makes contiguous periods partition a career with no gap and no overlap.
  it('covers its own start date', () => {
    expect(coversDay(period('2026-07-26', null), TODAY)).toBe(true);
  });

  it('does NOT cover its own end date — the successor starting that day does', () => {
    const ending = period('2026-07-01', '2026-07-26');
    const successor = period('2026-07-26', null);
    expect(coversDay(ending, TODAY)).toBe(false);
    expect(coversDay(successor, TODAY)).toBe(true);
  });

  // Exactly one period covers any given day, which is the property the identity line and
  // the History filter both lean on — one asks for it, the other for everything else.
  it('picks exactly one period out of a contiguous career', () => {
    const career = [
      period('2022-01-01', '2024-03-01'),
      period('2024-03-01', '2026-07-01'),
      period('2026-07-01', '2026-11-01'),
      period('2026-11-01', null),
    ];
    expect(career.filter((p) => coversDay(p, TODAY))).toEqual([career[2]]);
  });

  // The same calendar day arrives here as a UTC-midnight Date from `<input type="date">`
  // and as a full ISO timestamp from the seed; comparing instants would let those two
  // shapes answer differently. Strings are accepted for the same reason.
  it('reads a day, not an instant, whichever shape the date arrives in', () => {
    expect(coversDay({ startDate: '2026-07-26T23:59:59.000Z', endDate: null }, TODAY)).toBe(true);
    expect(coversDay({ startDate: d('2026-07-01'), endDate: '2026-07-26T23:59:59.000Z' }, TODAY)).toBe(false);
  });
});
