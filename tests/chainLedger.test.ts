import {
  computeChainLedger,
  buildBusiestResources,
  hasIdleGapBefore,
  isRealizedOverrun,
  isRealizedUnderrun,
  isForecastOver,
  isForecastUnder,
  FORECAST_NOISE_DAYS,
  SEVERE_OVERRUN_PCT,
  isSevereOverrun,
  type LedgerPhaseInput,
  type ChainLedgerInput,
} from '../src/lib/chainLedger';

// Fixed clock: day 0 = 2026-01-01T00:00:00Z. All day math in whole UTC days.
const DAY = 86_400_000;
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
): LedgerPhaseInput => ({
  id, name: `P${id}`, forecastedDuration, progress, parentIds, startedAt, completedAt,
});

describe('planned chain vs live constraint', () => {
  // A(30) → B(40) → C(30) is the planned chain (100d); A → D(35) is a branch.
  const phases = (bProgress: number) => [
    phase(1, 30, 100, [], iso(0), iso(27)),
    phase(2, 40, bProgress, [1], bProgress > 0 ? iso(30) : null),
    phase(3, 30, 0, [2]),
    phase(4, 35, 0, [1]),
  ];

  it('identifies the planned chain over FULL durations, ignoring progress', () => {
    const r = computeChainLedger({ phases: phases(0), sopDate: iso(140), now: day(40) });
    expect(r.plannedChain.path).toEqual([1, 2, 3]);
    expect(r.plannedChain.totalDays).toBe(100);
  });

  it('keeps the planned chain stable as progress lands (no silent migration)', () => {
    const r = computeChainLedger({ phases: phases(90), sopDate: iso(140), now: day(40) });
    // live longest-remaining path is now A→D (35d) vs B(4)+C(30)=34
    expect(r.plannedChain.path).toEqual([1, 2, 3]);
    expect(r.rebaselineSuggested).toBe(true);
  });

  it('does not suggest a re-baseline while the live path matches the plan', () => {
    const r = computeChainLedger({ phases: phases(10), sopDate: iso(140), now: day(40) });
    expect(r.rebaselineSuggested).toBe(false);
  });
});

describe('schedule rows, cascade, and buffer', () => {
  // A done early; 6 idle days; B active and trending over; C not started.
  const input: ChainLedgerInput = {
    phases: [
      phase(1, 30, 100, [], iso(0), iso(27)),   // planned 30, took 27 → gave back 3
      phase(2, 40, 50, [1], iso(33)),           // started day 33 (idle 28..33 vs completed 27)
      phase(3, 30, 0, [2]),
    ],
    sopDate: iso(140),
    now: day(60),
  };

  it('lays out done/active/notStarted rows with plan ticks and projections', () => {
    const r = computeChainLedger(input);
    const [a, b, c] = r.schedule;

    expect(a.kind).toBe('done');
    expect(a.startMs).toBe(day(0));
    expect(a.endMs).toBe(day(27));
    expect(a.plannedEndMs).toBe(day(30));
    expect(a.varianceDays).toBe(-3);

    expect(b.kind).toBe('active');
    expect(b.startMs).toBe(day(33));
    expect(b.remainingDays).toBe(20);            // 40 × (1 − 0.5)
    expect(b.endMs).toBe(day(80));               // now + 20
    expect(b.plannedEndMs).toBe(day(73));        // start + 40
    expect(b.varianceDays).toBe(7);              // elapsed 27 + remaining 20 − planned 40
    expect(b.gapBeforeDays).toBe(6);

    expect(c.kind).toBe('notStarted');
    expect(c.startMs).toBe(day(80));             // cascades from B's projected end
    expect(c.endMs).toBe(day(110));
    expect(c.gapBeforeDays).toBe(0);             // predecessor end is projected, not idle time
  });

  it('computes buffer, start buffer, used, and the 50%-rule guideline', () => {
    const r = computeChainLedger(input);
    expect(r.projectedFinishMs).toBe(day(110));
    expect(r.bufferDays).toBe(30);               // SOP 140 − finish 110
    expect(r.startBufferDays).toBe(40);          // SOP 140 − (start 0 + planned 100)
    expect(r.usedDays).toBe(10);
    expect(r.guidelineDays).toBe(25);            // 50% of remaining chain work (0+20+30)
  });

  it('the waterfall attributes every used day: gains, gaps, forecast, sunk', () => {
    const r = computeChainLedger(input);
    const kinds = Object.fromEntries(r.waterfall.map((w) => [w.kind, w.days]));
    expect(kinds.underrun).toBe(3);              // A gave back 3
    expect(kinds.gap).toBe(6);                   // idle before B
    expect(kinds.forecast).toBe(7);              // B trending over, not yet spent
    expect(kinds.unattributed).toBeUndefined();  // 6 + 7 − 3 = 10 = used → books balance
  });

  it('emits an unattributed row when the books do not balance', () => {
    // Same shape but B's start pre-dates A's start (plan edits / odd data): the
    // realized rows can no longer sum to usedDays.
    const r = computeChainLedger({
      ...input,
      phases: [
        phase(1, 30, 100, [], iso(5), iso(32)),  // t₀ = 5 → B₀ = 140 − 105 = 35
        phase(2, 40, 50, [1], iso(38)),
        phase(3, 30, 0, [2]),
      ],
      now: day(60),
    });
    // finish: B rem 20 → end 80; C → 110. buffer 30, B₀ 35, used 5.
    // realized: A var −3, gap 6 (32→38), forecast max(0, 22+20−40)=2 → 6+2−3 = 5 → balanced.
    const un = r.waterfall.find((w) => w.kind === 'unattributed');
    expect(un).toBeUndefined();
    expect(r.usedDays).toBe(5);
  });

  it('handles a missing SOP: no buffer, no overshoot', () => {
    const r = computeChainLedger({ ...input, sopDate: null });
    expect(r.bufferDays).toBeNull();
    expect(r.usedDays).toBeNull();
    expect(r.situations.find((s) => s.type === 'sopOvershoot')).toBeUndefined();
    // The register still speaks: no SOP kills the BUFFER judgment, but B is 18%
    // past its own estimate, and that comparison needs no SOP.
    expect(r.register).toBe('act');
  });
});

describe('forecast-noise threshold', () => {
  // A phase whose projection is exactly 1 day past plan: elapsed 21 + remaining
  // 20 (40 × 50%) = 41 against 40 planned. Below the noise floor, so it must
  // produce NOTHING anywhere — the chart renders from the same predicate, and
  // when the two disagreed a +1-day phase drew a red band and an "over plan"
  // label with no waterfall row behind it.
  const oneDayOver = computeChainLedger({
    phases: [phase(1, 40, 50, [], iso(0))],
    sopDate: iso(200),
    now: day(21),
  });

  it('ignores a one-day forecast overrun in the waterfall and situations', () => {
    expect(oneDayOver.schedule[0].varianceDays).toBe(1);
    expect(oneDayOver.waterfall.find((w) => w.kind === 'forecast')).toBeUndefined();
    expect(oneDayOver.situations.find((s) => s.type === 'forecastOverrun')).toBeUndefined();
  });

  it('exposes the same predicate the chart renders from', () => {
    expect(FORECAST_NOISE_DAYS).toBe(2);
    expect(isForecastOver(oneDayOver.schedule[0])).toBe(false);
    expect(isForecastOver({ kind: 'active', varianceDays: 2 })).toBe(true);
    // realized (done) variances are measured, not projected — they count from 1
    expect(isForecastOver({ kind: 'done', varianceDays: 9 })).toBe(false);
  });

  it('reports a two-day forecast overrun through both surfaces', () => {
    // elapsed 22 + remaining 20 = 42 vs 40 planned
    const r = computeChainLedger({
      phases: [phase(1, 40, 50, [], iso(0))],
      sopDate: iso(200),
      now: day(22),
    });
    expect(r.schedule[0].varianceDays).toBe(2);
    expect(r.waterfall.find((w) => w.kind === 'forecast')?.days).toBe(2);
    expect(r.situations.find((s) => s.type === 'forecastOverrun')).toMatchObject({ days: 2 });
  });
});

// All five pinned in one table, because the names ARE the interface: the next chart
// author reaches for one of these rather than writing a comparison. They were
// hand-copied across 20 comparisons in five files until autoknow-4dr.1 converged them;
// eslint's `chainPredicates` family stops the next copy being WRITTEN, and this stops
// the shared one being quietly redefined — a lint rule cannot tell you the single
// remaining definition changed its mind about which rows count.
describe('the five waterfall predicates', () => {
  it('keeps the realized/forecast threshold asymmetry', () => {
    // The FORECAST pair clears FORECAST_NOISE_DAYS; `isForecastOver` is also pinned
    // against a real ledger row in the forecast-noise block above.
    expect(isForecastOver({ kind: 'active', varianceDays: FORECAST_NOISE_DAYS })).toBe(true);
    expect(isForecastOver({ kind: 'active', varianceDays: 1 })).toBe(false);

    // REALIZED variances are measured between two real dates: they count from 1 day.
    expect(isRealizedOverrun({ kind: 'done', varianceDays: 1 })).toBe(true);
    expect(isRealizedOverrun({ kind: 'done', varianceDays: 0 })).toBe(false);
    expect(isRealizedUnderrun({ kind: 'done', varianceDays: -1 })).toBe(true);
    expect(isRealizedUnderrun({ kind: 'done', varianceDays: 0 })).toBe(false);
    // …and only for a phase that has actually finished. A live phase 9 days past its
    // plan is a FORECAST claim; calling it realized would double-count it against the
    // forecast row the waterfall already writes.
    expect(isRealizedOverrun({ kind: 'active', varianceDays: 9 })).toBe(false);
    expect(isRealizedOverrun({ kind: 'notStarted', varianceDays: 9 })).toBe(false);
    expect(isRealizedUnderrun({ kind: 'active', varianceDays: -9 })).toBe(false);

    // FORECAST variances clear the noise floor instead — the mirror of isForecastOver.
    expect(isForecastUnder({ kind: 'active', varianceDays: -FORECAST_NOISE_DAYS })).toBe(true);
    expect(isForecastUnder({ kind: 'active', varianceDays: -1 })).toBe(false);
    expect(isForecastUnder({ kind: 'done', varianceDays: -9 })).toBe(false);

    // A gap is a gap from one whole day; `kind` says nothing about it, because the day
    // was lost BETWEEN phases rather than inside one.
    expect(hasIdleGapBefore({ gapBeforeDays: 1 })).toBe(true);
    expect(hasIdleGapBefore({ gapBeforeDays: 0 })).toBe(false);
  });
});

describe('situation detection', () => {
  it('detects underrun, idle handoff, forecast overrun, and the upcoming handoff', () => {
    const r = computeChainLedger({
      phases: [
        phase(1, 30, 100, [], iso(0), iso(27)),
        phase(2, 40, 50, [1], iso(33)),
        phase(3, 30, 0, [2]),
      ],
      sopDate: iso(140),
      now: day(60),
      resources: [
        { kind: 'partner', id: 9, name: 'Bosch', phaseId: 3, otherPrograms: [] },
      ],
    });
    const types = r.situations.map((s) => s.type).sort();
    expect(types).toEqual(['forecastOverrun', 'idleHandoff', 'underrun', 'upcomingHandoff']);

    const gap = r.situations.find((s) => s.type === 'idleHandoff')!;
    expect(gap).toMatchObject({ fromId: 1, toId: 2, days: 6 });

    const fc = r.situations.find((s) => s.type === 'forecastOverrun')!;
    expect(fc).toMatchObject({ phaseId: 2, days: 7, remainingDays: 20 });

    const up = r.situations.find((s) => s.type === 'upcomingHandoff')!;
    expect(up).toMatchObject({ fromId: 2, toId: 3, resourceNames: ['Bosch'] });
  });

  it('detects a sunk overrun with its contended resources', () => {
    const r = computeChainLedger({
      phases: [
        phase(1, 30, 100, [], iso(0), iso(39)),  // took 39 vs 30 → sunk +9
        phase(2, 40, 20, [1], iso(39)),
      ],
      sopDate: iso(140),
      now: day(60),
      resources: [
        { kind: 'partner', id: 9, name: 'Bosch', phaseId: 1, otherPrograms: [
          { programId: 7, programName: 'Nova', bufferDays: 34 },
        ] },
      ],
    });
    const sunk = r.situations.find((s) => s.type === 'sunkOverrun')!;
    expect(sunk).toMatchObject({ phaseId: 1, days: 9 });
    // contended resources carry identity, not just names — every mention links
    expect(sunk.type === 'sunkOverrun' && sunk.contended).toEqual([{ kind: 'partner', id: 9, name: 'Bosch' }]);
  });

  it('detects oversubscription and partitions the other programs by buffer', () => {
    const r = computeChainLedger({
      phases: [phase(1, 30, 40, [], iso(0))],
      sopDate: iso(140),
      now: day(20),
      resources: [
        { kind: 'person', id: 5, name: 'Alice Chen', phaseId: 1, otherPrograms: [
          { programId: 7, programName: 'Nova', bufferDays: 34 },
          { programId: 8, programName: 'Meridian', bufferDays: 21 },
          { programId: 9, programName: 'Polaris EV', bufferDays: -4 },
        ] },
      ],
    });
    const o = r.situations.find((s) => s.type === 'oversubscribed')!;
    expect(o.type === 'oversubscribed' && o.name).toBe('Alice Chen');
    // givers: positive buffer, richest first; tight: zero or negative buffer
    expect(o.type === 'oversubscribed' && o.moves.map((m) => m.programName)).toEqual(['Nova', 'Meridian']);
    expect(o.type === 'oversubscribed' && o.tight.map((m) => m.programName)).toEqual(['Polaris EV']);
  });

  it('detects SOP overshoot with a sized month proposal and delayed units', () => {
    const r = computeChainLedger({
      phases: [phase(1, 60, 0, [], null, null)],
      sopDate: iso(40),                          // finish ≈ day 60 → 20 days past SOP
      now: day(0),
      volumeFirstYear: 120_000,
    });
    expect(r.bufferDays).toBe(-20);
    expect(r.register).toBe('act');
    const over = r.situations.find((s) => s.type === 'sopOvershoot')!;
    expect(over).toMatchObject({ days: 20 });
    // day 60 = 2026-03-02 → propose the month the work actually lands in
    expect(over.type === 'sopOvershoot' && over.proposedSopMonth).toBe('2026-03');
    expect(over.type === 'sopOvershoot' && over.unitsDelayed).toBe(Math.round((120_000 * 20) / 365));
  });

  it('reports all clear when nothing needs attention', () => {
    const r = computeChainLedger({
      phases: [
        phase(1, 30, 100, [], iso(0), iso(30)),
        phase(2, 40, 50, [1], iso(30)),          // elapsed 10 + rem 20 = 30 ≤ 40 → on plan
      ],
      sopDate: iso(140),
      now: day(40),
    });
    expect(r.situations.map((s) => s.type)).toEqual(['allClear']);
    expect(r.register).toBe('none');
  });
});

describe('overrun severity and the immediate focus', () => {
  it('sizes every overrun against its own estimate, not in bare days', () => {
    // Both phases are 6 days over. On a 10-day estimate that is a different program
    // than on a 200-day one, and the ledger used to report both as "6 days".
    const r = computeChainLedger({
      phases: [
        phase(1, 10, 100, [], iso(0), iso(16)),   // done, +6 on 10 → 60%
        phase(2, 200, 50, [1], iso(16)),          // active: elapsed 106 + rem 100 − 200 = 6 → 3%
      ],
      sopDate: iso(400),
      now: day(122),
    });
    const sunk = r.situations.find((s) => s.type === 'sunkOverrun')!;
    expect(sunk).toMatchObject({ days: 6, plannedDays: 10, overPct: 60 });
    const live = r.situations.find((s) => s.type === 'forecastOverrun')!;
    expect(live).toMatchObject({ days: 6, plannedDays: 200, overPct: 3 });
  });

  it('raises a live phase past the threshold to the immediate focus', () => {
    const r = computeChainLedger({
      phases: [phase(1, 40, 50, [], iso(0)), phase(2, 40, 30, [1], iso(0))],
      sopDate: iso(400),                          // buffer is enormous and irrelevant
      now: day(30),
    });
    // P1: elapsed 30 + rem 20 − 40 = 10 → 25%. P2: 30 + 28 − 40 = 18 → 45%.
    expect(r.immediateFocus).toEqual({
      phaseId: 2, phaseName: 'P2', overPct: 45, remainingDays: 28, count: 2,
    });
    expect(r.bufferDays).toBeGreaterThan(0);
    expect(r.register).toBe('act');               // a healthy buffer does not silence it
  });

  it('leaves a small live overrun off the immediate focus', () => {
    // elapsed 105 + rem 100 = 205 vs 200 planned → 5 days, 3% — real, but a line
    // item rather than a reason to stop the program.
    const r = computeChainLedger({
      phases: [phase(1, 200, 50, [], iso(0))],
      sopDate: iso(400),
      now: day(105),
    });
    expect(r.situations.find((s) => s.type === 'forecastOverrun')).toMatchObject({ days: 5, overPct: 3 });
    expect(r.immediateFocus).toBeNull();
    expect(r.register).toBe('none');
  });

  it('never raises a FINISHED overrun to the immediate focus', () => {
    // 100% over its estimate, but done: that time is spent, so it earns a re-plan,
    // not an all-hands. Nothing left to exploit.
    const r = computeChainLedger({
      phases: [phase(1, 20, 100, [], iso(0), iso(40))],
      sopDate: iso(400),
      now: day(45),
    });
    expect(r.situations.find((s) => s.type === 'sunkOverrun')).toMatchObject({ days: 20, overPct: 100 });
    expect(r.immediateFocus).toBeNull();
  });

  it('exposes the one predicate both the bullet copy and the flag choose from', () => {
    expect(SEVERE_OVERRUN_PCT).toBe(10);
    expect(isSevereOverrun({ overPct: 9 })).toBe(false);
    expect(isSevereOverrun({ overPct: 10 })).toBe(true);   // at the threshold, not past it
  });
});

describe('trend replay and register', () => {
  const input: ChainLedgerInput = {
    phases: [
      phase(1, 30, 100, [], iso(0), iso(20)),
      phase(2, 30, 50, [1], iso(30)),
    ],
    sopDate: iso(100),
    now: day(56),
    states: [
      { phaseId: 1, at: iso(0), progress: 10 },
      { phaseId: 1, at: iso(10), progress: 50 },
      { phaseId: 1, at: iso(20), progress: 100 },
      { phaseId: 2, at: iso(30), progress: 20 },
      { phaseId: 2, at: iso(50), progress: 50 },
    ],
  };

  it('replays buffer over time from the append-only state history', () => {
    const r = computeChainLedger(input);
    expect(r.trend.length).toBeGreaterThan(3);
    expect(r.trend[r.trend.length - 1].bufferDays).toBe(r.bufferDays);
    // buffer at now: A done (−10), B started 30 elapsed 26 rem 15 → end 71 → 100−71 = 29
    expect(r.bufferDays).toBe(29);
  });

  it('computes the four-week delta', () => {
    const r = computeChainLedger(input);
    // at day 28: A done@20, B unstarted → starts at 28, ends 58 → buffer 42
    expect(r.fourWeekDeltaDays).toBe(29 - 42);
    // The four-week loss alone would read 'plan', but B is also 37% past its own
    // 30-day estimate, and a live overrun outranks a still-positive buffer.
    expect(r.register).toBe('act');
  });

  it('escalates to plan (not act) when only the four-week loss is bad', () => {
    // Same shape with the loss coming from IDLE time instead of an overrun: A
    // finishes exactly on plan, then nothing starts for 26 days.
    const r = computeChainLedger({
      phases: [
        phase(1, 30, 100, [], iso(0), iso(30)),
        phase(2, 30, 0, [1]),
      ],
      sopDate: iso(120),
      now: day(56),
      states: [
        { phaseId: 1, at: iso(0), progress: 10 },
        { phaseId: 1, at: iso(15), progress: 50 },
        { phaseId: 1, at: iso(30), progress: 100 },
      ],
    });
    expect(r.immediateFocus).toBeNull();
    expect(r.bufferDays).toBe(34);               // B cascades to now → ends day 86
    expect(r.fourWeekDeltaDays).toBe(34 - 47);   // at day 28 A was still running
    expect(r.register).toBe('plan');
  });

  it('stays quiet without states: no trend, no delta', () => {
    const r = computeChainLedger({ ...input, states: undefined });
    expect(r.trend).toEqual([]);
    expect(r.fourWeekDeltaDays).toBeNull();
  });
});

describe('buildBusiestResources', () => {
  const rows = buildBusiestResources([
    {
      programId: 1, programName: 'Gemini X', bufferDays: 47, fourWeekDeltaDays: -14,
      volumeFirstYear: 120_000, products: ['GAS', 'GBI'],
      resources: [
        { kind: 'person', id: 5, name: 'Alice Chen', onConstraint: true },
        { kind: 'partner', id: 9, name: 'Bosch', onConstraint: false },
      ],
    },
    {
      programId: 2, programName: 'Polaris EV', bufferDays: 12, fourWeekDeltaDays: -9,
      volumeFirstYear: 60_000, products: ['GBI'],
      resources: [{ kind: 'person', id: 5, name: 'Alice Chen', onConstraint: true }],
    },
    {
      programId: 3, programName: 'Meridian', bufferDays: 21, fourWeekDeltaDays: -6,
      volumeFirstYear: 45_000, products: [],
      resources: [
        { kind: 'partner', id: 9, name: 'Bosch', onConstraint: true },
        { kind: 'person', id: 5, name: 'Alice Chen', onConstraint: false },
      ],
    },
    {
      programId: 4, programName: 'Nova', bufferDays: 34, fourWeekDeltaDays: 0,
      volumeFirstYear: 0, products: [],
      resources: [{ kind: 'person', id: 6, name: 'Sofia Marin', onConstraint: false }],
    },
  ]);

  it('aggregates each resource across programs, most exposure first', () => {
    expect(rows.map((r) => r.name)).toEqual(['Alice Chen', 'Bosch', 'Sofia Marin']);
    const alice = rows[0];
    expect(alice.constraintIn.map((p) => p.programName)).toEqual(['Gemini X', 'Polaris EV']);
    expect(alice.alsoActiveIn.map((p) => p.programName)).toEqual(['Meridian']);
  });

  it('carries the decision facts: deltas, volumes, products, movable slack', () => {
    const alice = rows[0];
    expect(alice.constraintIn[0]).toMatchObject({
      programName: 'Gemini X', fourWeekDeltaDays: -14, volumeFirstYear: 120_000, products: ['GAS', 'GBI'],
    });
    // movable slack: non-constraint programs with positive buffer, richest first
    expect(alice.movable.map((p) => p.programName)).toEqual(['Meridian']);
    // tie-break fact for "which program gets their time": constraint programs by volume
    expect(alice.constraintIn[0].volumeFirstYear).toBeGreaterThan(alice.constraintIn[1].volumeFirstYear);
  });

  it('flags a resource gating exactly one SOP (the named-team ask)', () => {
    const bosch = rows.find((r) => r.name === 'Bosch')!;
    expect(bosch.constraintIn.map((p) => p.programName)).toEqual(['Meridian']);
    expect(bosch.gatesSingleSop).toBe(true);
  });

  it('gives an idle resource no suggestions', () => {
    const sofia = rows.find((r) => r.name === 'Sofia Marin')!;
    expect(sofia.constraintIn).toEqual([]);
    expect(sofia.movable).toEqual([]);
    expect(sofia.gatesSingleSop).toBe(false);
  });
});
