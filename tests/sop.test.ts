import { monthEndDate, parseSopInput, sopOutlook, buildProductCapacitySeries, unitsAt, riskScore, sopBufferRisk, sopBufferCategory, sopBufferClass, isSopFlagged, guidelineFor, DAY_MS } from '../src/lib/sop';

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

// The four SOP classes and the two "no reading" answers. NOW is 2026-07-13 and every
// fixture carries 74 remaining chain days, so the 50%-rule reserve is 37 days and the
// forecast finish is 2026-09-25 — each date below is chosen against those two numbers.
const NOW = Date.UTC(2026, 6, 13); // 2026-07-13
const PASSED = new Date(Date.UTC(2026, 5, 30)).toISOString(); // 2026-06-30 — already gone
const SOON = new Date(Date.UTC(2026, 7, 31)).toISOString(); // 2026-08-31 — ahead, but before the finish
const THIN = new Date(Date.UTC(2026, 9, 15)).toISOString(); // 2026-10-15 — 20 days of buffer, under the 37-day reserve
const FAR = new Date(Date.UTC(2028, 2, 31)).toISOString(); // ~20 months of runway
const ACTIVE = { isArchived: false, lifecycle: 'active', hillChartProgress: 40, sopDate: FAR, chainRemainingDays: 74 };

describe('sopBufferClass — the one reading of a buffer, severity-ordered', () => {
  it('splits a MISSED date from a forecast miss: same overshoot, passed SOP is worse', () => {
    const args = { bufferDays: -30, guidelineDays: 20, now: NOW };
    expect(sopBufferClass({ ...args, sopMs: NOW - 10 * DAY_MS })).toBe('blown');
    expect(sopBufferClass({ ...args, sopMs: NOW + 40 * DAY_MS })).toBe('late');
  });

  it('calls a positive buffer under the 50%-rule reserve atrisk, and a comfortable one ontrack', () => {
    const args = { guidelineDays: 20, sopMs: NOW + 300 * DAY_MS, now: NOW };
    expect(sopBufferClass({ ...args, bufferDays: 5 })).toBe('atrisk');
    expect(sopBufferClass({ ...args, bufferDays: 200 })).toBe('ontrack');
  });

  it('tests exhaustion BEFORE the guideline — a deep overshoot is never merely thin', () => {
    // A large guideline must not swallow the overshoot branch: -30 is late, not atrisk.
    expect(sopBufferClass({ bufferDays: -30, guidelineDays: 5000, sopMs: NOW + DAY_MS, now: NOW })).toBe('late');
  });

  it('is ontrack with no buffer data at all — never a guess', () => {
    expect(sopBufferClass({ bufferDays: null, guidelineDays: null, sopMs: NOW, now: NOW })).toBe('ontrack');
  });

});

describe('guidelineFor — the one place the 50% rule lives', () => {
  // sopBufferClassFor and chainLedger both measure this rule, over different chains.
  // Pinning the helper rather than each caller's literal is what keeps "50%" one edit.
  it('is half the remaining work, rounded', () => {
    expect(guidelineFor(74)).toBe(37);
    expect(guidelineFor(75)).toBe(38);
    expect(guidelineFor(0)).toBe(0);
  });
});

describe('sopBufferCategory — the per-program token the SOP-outlook column filters on', () => {
  it('reads all four classes off a program\'s own chain and SOP', () => {
    expect(sopBufferCategory({ ...ACTIVE, sopDate: PASSED }, NOW)).toBe('blown');
    expect(sopBufferCategory({ ...ACTIVE, sopDate: SOON }, NOW)).toBe('late');
    expect(sopBufferCategory({ ...ACTIVE, sopDate: THIN }, NOW)).toBe('atrisk');
    expect(sopBufferCategory({ ...ACTIVE, sopDate: FAR }, NOW)).toBe('ontrack');
  });

  it('takes the 50%-rule reserve from the same remaining-chain days the buffer is measured from', () => {
    // 20 days of buffer is thin against 74 days of chain (reserve 37) and comfortable
    // against 10 (reserve 5) — the SAME SOP date, classified by the work still ahead.
    expect(sopBufferCategory({ ...ACTIVE, sopDate: THIN, chainRemainingDays: 74 }, NOW)).toBe('atrisk');
    expect(sopBufferCategory({ ...ACTIVE, sopDate: THIN, chainRemainingDays: 10 }, NOW)).toBe('ontrack');
  });

  it('is nosop for an active program with no target, na for anything not active', () => {
    expect(sopBufferCategory({ ...ACTIVE, sopDate: null }, NOW)).toBe('nosop');
    expect(sopBufferCategory({ ...ACTIVE, sopDate: SOON, hillChartProgress: 100 }, NOW)).toBe('na');
    expect(sopBufferCategory({ ...ACTIVE, sopDate: SOON, lifecycle: 'cancelled' }, NOW)).toBe('na');
    expect(sopBufferCategory({ ...ACTIVE, sopDate: SOON, isArchived: true }, NOW)).toBe('na');
  });
});

describe('sopBufferRisk — the ecosystem tally behind the "SOP at risk" tile', () => {
  it('counts all three bad classes, and breaks out the missed dates', () => {
    const r = sopBufferRisk(
      [
        { ...ACTIVE, sopDate: PASSED },
        { ...ACTIVE, sopDate: SOON },
        { ...ACTIVE, sopDate: THIN },
        { ...ACTIVE, sopDate: FAR },
      ],
      NOW,
    );
    expect(r).toEqual({ blown: 1, late: 1, atrisk: 1, flagged: 3, assessable: 4, undated: 0 });
  });

  it('counts a thin buffer the OLD rule called on track — the tile now agrees with the header', () => {
    // This is the whole point of the change: `buffer < 0` alone said 0 here, while
    // ProjectMetaHeader painted the same program --warn at the 50% line.
    const r = sopBufferRisk([{ ...ACTIVE, sopDate: THIN }], NOW);
    expect(r.flagged).toBe(1);
    expect(r.atrisk).toBe(1);
    expect(r.blown + r.late).toBe(0);
  });

  it('reports SOP-less active programs separately instead of counting them safe', () => {
    const r = sopBufferRisk([{ ...ACTIVE, sopDate: null }], NOW);
    expect(r).toEqual({ blown: 0, late: 0, atrisk: 0, flagged: 0, assessable: 0, undated: 1 });
  });

  it('ignores everything that is not Active — done, cancelled, archived', () => {
    // Each of these overshoots its SOP badly; none of them is going to ship late.
    const late = { ...ACTIVE, sopDate: SOON };
    const r = sopBufferRisk(
      [
        { ...late, hillChartProgress: 100 }, // Done by progress
        { ...late, lifecycle: 'complete' }, // Done explicitly
        { ...late, lifecycle: 'cancelled' },
        { ...late, isArchived: true },
      ],
      NOW,
    );
    expect(r).toEqual({ blown: 0, late: 0, atrisk: 0, flagged: 0, assessable: 0, undated: 0 });
  });

  it('is all zeros on an empty ecosystem', () => {
    expect(sopBufferRisk([], NOW)).toEqual({ blown: 0, late: 0, atrisk: 0, flagged: 0, assessable: 0, undated: 0 });
  });

  it('agrees with the deep link by construction: flagged == the set SOP_FLAGGED_CLASSES selects', () => {
    // The tile's figure and the /programs rows its href reveals are ONE set, or the
    // door lies about what is behind it.
    const programs = [
      { ...ACTIVE, sopDate: PASSED },
      { ...ACTIVE, sopDate: SOON },
      { ...ACTIVE, sopDate: THIN },
      { ...ACTIVE, sopDate: FAR },
      { ...ACTIVE, sopDate: null },
      { ...ACTIVE, sopDate: SOON, lifecycle: 'cancelled' },
    ];
    const selected = programs.filter((p) => isSopFlagged(sopBufferCategory(p, NOW))).length;
    expect(selected).toBe(sopBufferRisk(programs, NOW).flagged);
    expect(selected).toBe(3);
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
