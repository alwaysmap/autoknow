import { monthEndDate, parseSopInput, sopOutlook, buildProductCapacitySeries, unitsAt, riskScore, sopBufferRisk, sopBufferCategory, DAY_MS } from '../src/lib/sop';

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
    expect(o.bufferDays).toBeGreaterThan(180);
  });

  it('is late when the chain overshoots the SOP', () => {
    const o = sopOutlook(74, new Date(Date.UTC(2026, 7, 31)), now); // SOP 2026-08-31
    expect(o.onTrack).toBe(false);
    expect(o.bufferDays).toBe(Math.round((Date.UTC(2026, 7, 31) - (now + 74 * DAY_MS)) / DAY_MS));
    expect(o.bufferDays).toBeLessThan(0);
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

describe('buildProductCapacitySeries', () => {
  const now = Date.UTC(2026, 6, 13);
  const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString();

  it('ramps each program from its SOP to SOP+12mo, stacked by product', () => {
    const { points, excluded } = buildProductCapacitySeries(
      [
        { sopDate: iso(2026, 9, 30), volumeFirstYear: 100_000, hasGas: true, hasGbi: true },
        { sopDate: iso(2027, 3, 31), volumeFirstYear: 50_000, hasGas: false, hasDigitalKey: true, hasAap: true },
        { sopDate: null, volumeFirstYear: 999_999, hasGas: true }, // undated → excluded
        // lifecycle boundary: cancelled units never ship — out of the chart.
        // (Archived programs STAY in charts — see the archived case below.)
        { sopDate: iso(2027, 3, 31), volumeFirstYear: 77, hasGas: true, lifecycle: 'cancelled' },
      ],
      now,
    );
    expect(excluded).toBe(1);

    // At the SOP quarter's end the ramp has just begun: 0, not the full volume.
    const q326 = points.find((p) => p.label === 'Q3 ’26')!;
    expect(q326.units.aaos).toBe(0);

    // A quarter later, roughly a quarter of the first program's year has elapsed —
    // and that vehicle capacity counts once per product it carries (AAOS, GAS, GBI).
    const q426 = points.find((p) => p.label === 'Q4 ’26')!;
    expect(q426.units.aaos).toBeGreaterThan(20_000);
    expect(q426.units.aaos).toBeLessThan(30_000);
    expect(q426.units.gas).toBe(q426.units.aaos);
    expect(q426.units.gbi).toBe(q426.units.aaos);
    expect(q426.units.digitalKey).toBe(0);

    // The series runs through the LAST ramp: everything delivered by the end —
    // and the cancelled program's 77 units are nowhere in it.
    const last = points[points.length - 1];
    expect(last.units.aaos).toBe(150_000); // every vehicle is an AAOS vehicle
    expect(last.units.gas).toBe(100_000);
    expect(last.units.gbi).toBe(100_000);
    expect(last.units.digitalKey).toBe(50_000);
    expect(last.units.aap).toBe(50_000);

    // Monotonic: units in consumer hands never go down.
    for (let i = 1; i < points.length; i++) {
      expect(points[i].units.aaos).toBeGreaterThanOrEqual(points[i - 1].units.aaos);
    }
  });

  it('keeps archived programs in the chart (lists hide them; charts never do)', () => {
    // lib/lifecycle boundary: isArchived is VISIBILITY, not truth — an archived
    // program's shipped/committed units still exist.
    const { points } = buildProductCapacitySeries(
      [{ sopDate: iso(2026, 9, 30), volumeFirstYear: 10_000, hasGas: false, lifecycle: 'complete' }],
      now,
    );
    expect(points[points.length - 1].units.aaos).toBe(10_000);
  });

  it('is empty (not crashing) with no dated programs', () => {
    const { points, excluded } = buildProductCapacitySeries(
      [{ sopDate: null, volumeFirstYear: 10, hasGas: false }],
      now,
    );
    expect(points).toEqual([]);
    expect(excluded).toBe(1);
  });
});

describe('sopBufferRisk — programs projected to blow their SOP', () => {
  const now = Date.UTC(2026, 6, 13); // 2026-07-13
  const soon = new Date(Date.UTC(2026, 7, 31)).toISOString(); // 2026-08-31
  const far = new Date(Date.UTC(2028, 2, 31)).toISOString();
  const active = {
    isArchived: false,
    lifecycle: 'active',
    hillChartProgress: 40,
    sopDate: far,
    chainRemainingDays: 74,
  };

  it('counts a program only when its buffer is gone (chain overshoots the SOP)', () => {
    const r = sopBufferRisk(
      [
        { ...active, sopDate: far }, // 74 days of work, ~20 months of runway
        { ...active, sopDate: soon }, // 74 days of work, ~7 weeks of runway
      ],
      now,
    );
    expect(r).toEqual({ late: 1, assessable: 2, undated: 0 });
  });

  it('reports SOP-less active programs separately instead of counting them safe', () => {
    const r = sopBufferRisk([{ ...active, sopDate: null }], now);
    expect(r).toEqual({ late: 0, assessable: 0, undated: 1 });
  });

  it('ignores everything that is not Active — done, cancelled, archived', () => {
    // Each of these overshoots its SOP badly; none of them is going to ship late.
    const late = { ...active, sopDate: soon };
    const r = sopBufferRisk(
      [
        { ...late, hillChartProgress: 100 }, // Done by progress
        { ...late, lifecycle: 'complete' }, // Done explicitly
        { ...late, lifecycle: 'cancelled' },
        { ...late, isArchived: true },
      ],
      now,
    );
    expect(r).toEqual({ late: 0, assessable: 0, undated: 0 });
  });

  it('is all zeros on an empty ecosystem', () => {
    expect(sopBufferRisk([], now)).toEqual({ late: 0, assessable: 0, undated: 0 });
  });
});

describe('sopBufferCategory — the per-program token the SOP-outlook column filters on', () => {
  const now = Date.UTC(2026, 6, 13); // 2026-07-13
  const soon = new Date(Date.UTC(2026, 7, 31)).toISOString(); // 2026-08-31
  const far = new Date(Date.UTC(2028, 2, 31)).toISOString();
  const active = { isArchived: false, lifecycle: 'active', hillChartProgress: 40, sopDate: far, chainRemainingDays: 74 };

  it('is late only when the chain overshoots the SOP, else ontrack', () => {
    expect(sopBufferCategory({ ...active, sopDate: soon }, now)).toBe('late');
    expect(sopBufferCategory({ ...active, sopDate: far }, now)).toBe('ontrack');
  });

  it('is nosop for an active program with no target, na for anything not active', () => {
    expect(sopBufferCategory({ ...active, sopDate: null }, now)).toBe('nosop');
    expect(sopBufferCategory({ ...active, sopDate: soon, hillChartProgress: 100 }, now)).toBe('na');
    expect(sopBufferCategory({ ...active, sopDate: soon, lifecycle: 'cancelled' }, now)).toBe('na');
    expect(sopBufferCategory({ ...active, sopDate: soon, isArchived: true }, now)).toBe('na');
  });

  it('agrees with sopBufferRisk by construction (the tile count == the ?sopOutlook=late set)', () => {
    const programs = [
      { ...active, sopDate: soon }, // late
      { ...active, sopDate: soon }, // late
      { ...active, sopDate: far }, // ontrack
      { ...active, sopDate: null }, // nosop
      { ...active, sopDate: soon, lifecycle: 'cancelled' }, // na
    ];
    const late = programs.filter((p) => sopBufferCategory(p, now) === 'late').length;
    expect(late).toBe(sopBufferRisk(programs, now).late);
    expect(late).toBe(2);
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
