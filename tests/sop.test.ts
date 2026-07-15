import { monthEndDate, parseSopInput, sopOutlook, buildCapacitySeries, unitsAt, riskScore, DAY_MS } from '../src/lib/sop';

// SOP-target math: month-end assumption, the on-track signal (remaining chain weeks
// vs the SOP date), the quarterly capacity series (with/without GAS), and risk ranking.

describe('monthEndDate / parseSopInput', () => {
  it('assumes the LAST day of the month', () => {
    expect(monthEndDate('2027-03').toISOString()).toBe('2027-03-31T00:00:00.000Z');
    expect(monthEndDate('2028-02').toISOString()).toBe('2028-02-29T00:00:00.000Z'); // leap
    expect(monthEndDate('2027-04').toISOString()).toBe('2027-04-30T00:00:00.000Z');
  });

  it('accepts yyyy-MM (month input) and yyyy-MM-dd (legacy), rejects junk', () => {
    expect(parseSopInput('2027-03')!.toISOString()).toBe('2027-03-31T00:00:00.000Z');
    expect(parseSopInput('2027-03-15')!.toISOString()).toBe('2027-03-15T00:00:00.000Z');
    expect(parseSopInput('')).toBeNull();
    expect(parseSopInput('soon')).toBeNull();
  });
});

describe('sopOutlook', () => {
  const now = Date.UTC(2026, 6, 13); // 2026-07-13

  it('is on track when remaining chain work lands before the SOP', () => {
    const o = sopOutlook(74, new Date(Date.UTC(2027, 2, 31)), now);
    expect(o.onTrack).toBe(true);
    expect(o.slackDays).toBeGreaterThan(180);
  });

  it('is late when the chain overshoots the SOP', () => {
    const o = sopOutlook(74, new Date(Date.UTC(2026, 7, 31)), now); // SOP 2026-08-31
    expect(o.onTrack).toBe(false);
    expect(o.slackDays).toBe(Math.round((Date.UTC(2026, 7, 31) - (now + 74 * DAY_MS)) / DAY_MS));
    expect(o.slackDays).toBeLessThan(0);
  });
});

describe('unitsAt — the 12-month post-SOP ramp', () => {
  const sop = Date.UTC(2026, 8, 30); // 2026-09-30

  it('is 0 at (and before) SOP, full at SOP+12mo, holding after', () => {
    expect(unitsAt(sop, 100_000, sop - 30 * DAY_MS)).toBe(0);
    expect(unitsAt(sop, 100_000, sop)).toBe(0);
    expect(unitsAt(sop, 100_000, sop + 365 * DAY_MS)).toBe(100_000);
    expect(unitsAt(sop, 100_000, sop + 700 * DAY_MS)).toBe(100_000);
  });

  it('ramps linearly in between (half the volume at ~6 months)', () => {
    const half = unitsAt(sop, 100_000, sop + 182.5 * DAY_MS);
    expect(half).toBeGreaterThan(49_000);
    expect(half).toBeLessThan(51_000);
  });
});

describe('buildCapacitySeries', () => {
  const now = Date.UTC(2026, 6, 13);
  const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString();

  it('ramps each program from its SOP to SOP+12mo, split by GAS', () => {
    const { points, excluded } = buildCapacitySeries(
      [
        { sopDate: iso(2026, 9, 30), volumeFirstYear: 100_000, hasGas: true },
        { sopDate: iso(2027, 3, 31), volumeFirstYear: 50_000, hasGas: false },
        { sopDate: null, volumeFirstYear: 999_999, hasGas: true }, // undated → excluded
        { sopDate: iso(2027, 3, 31), volumeFirstYear: 77, hasGas: true, isArchived: true }, // archived → ignored
      ],
      now,
    );
    expect(excluded).toBe(1);

    // At the SOP quarter's end the ramp has just begun: 0, not the full volume.
    const q326 = points.find((p) => p.label === 'Q3 ’26')!;
    expect(q326.withGas).toBe(0);
    expect(q326.withoutGas).toBe(0);

    // A quarter later, roughly a quarter of the first program's year has elapsed.
    const q426 = points.find((p) => p.label === 'Q4 ’26')!;
    expect(q426.withGas).toBeGreaterThan(20_000);
    expect(q426.withGas).toBeLessThan(30_000);
    expect(q426.withoutGas).toBe(0);

    // The series runs through the LAST ramp: everything delivered by the end.
    const last = points[points.length - 1];
    expect(last.withGas).toBe(100_000);
    expect(last.withoutGas).toBe(50_000);

    // Monotonic: units in consumer hands never go down.
    for (let i = 1; i < points.length; i++) {
      expect(points[i].withGas).toBeGreaterThanOrEqual(points[i - 1].withGas);
      expect(points[i].withoutGas).toBeGreaterThanOrEqual(points[i - 1].withoutGas);
    }
  });

  it('is empty (not crashing) with no dated programs', () => {
    const { points, excluded } = buildCapacitySeries(
      [{ sopDate: null, volumeFirstYear: 10, hasGas: false }],
      now,
    );
    expect(points).toEqual([]);
    expect(excluded).toBe(1);
  });
});

describe('riskScore', () => {
  it('health severity dominates; lateness breaks ties; missing SOP adds nothing', () => {
    const concernedOnTime = riskScore(2, 30);
    const concernedLate = riskScore(2, -20);
    const someRiskVeryLate = riskScore(1, -500);
    const onTrackNoSop = riskScore(0, null);
    expect(concernedLate).toBeGreaterThan(concernedOnTime);
    expect(concernedOnTime).toBeGreaterThan(someRiskVeryLate); // health beats lateness
    expect(someRiskVeryLate).toBeGreaterThan(onTrackNoSop);
  });
});
