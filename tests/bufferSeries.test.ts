import { computeChainLedger, type ChainLedgerInput, type ChainLedgerResult, type LedgerPhaseInput } from '../src/lib/chainLedger';
import { bufferSeries } from '../src/lib/bufferSeries';

// Fixed clock: day 0 = 2026-01-01T00:00:00Z. All day math in whole UTC days,
// matching tests/chainLedger.test.ts so a fixture can be read across both files.
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
): LedgerPhaseInput => ({ id, name: `P${id}`, forecastedDuration, progress, parentIds, startedAt, completedAt });

/** A(30) done 3 days early · 6 idle days · B(40) live and 7 days over · C(30) queued. */
const mixed = (sopDay: number): ChainLedgerInput => ({
  phases: [
    phase(1, 30, 100, [], iso(0), iso(27)),
    phase(2, 40, 50, [1], iso(33)),
    phase(3, 30, 0, [2]),
  ],
  sopDate: iso(sopDay),
  now: day(60),
});

/** A(30) done 10 days early, nothing else off plan — the buffer ends up ABOVE B₀. */
const early: ChainLedgerInput = {
  phases: [
    phase(1, 30, 100, [], iso(0), iso(20)),
    phase(2, 40, 50, [1], iso(20)),
    phase(3, 30, 0, [2]),
  ],
  sopDate: iso(120),
  now: day(40),
};

/** B is exactly 1 day over — under the ledger's own forecast noise floor. */
const noise: ChainLedgerInput = {
  phases: [
    phase(1, 30, 100, [], iso(0), iso(30)),
    phase(2, 40, 25, [1], iso(30)),
    phase(3, 30, 0, [2]),
  ],
  sopDate: iso(150),
  now: day(41),
};

/**
 * The waterfall's ATTRIBUTED net — every row that points at a phase or a handoff.
 * Deliberately excludes the `unattributed` row: that row is a reconciliation, sized
 * to whatever `usedDays` does not explain, so a net that includes it can never
 * disagree with the ledger and would blame bufferSeries for every ledger bug.
 */
const attributedNet = (l: ChainLedgerResult) =>
  l.waterfall.filter((w) => w.kind !== 'unattributed').reduce((sum, w) => sum + (w.gain ? -w.days : w.days), 0);

/**
 * THE GATE (issue #161, step 1). The flow and "Where the buffer went" are two
 * renderings of one set of books; if they disagree, one of them is lying. Three
 * independent numbers say WHICH: the day-walk, the waterfall's attributed rows,
 * and the ledger's own `usedDays`. Whichever two agree, the third is the liar.
 */
function expectBooksBalance(l: ChainLedgerResult, now: number) {
  const s = bufferSeries(l, now);
  if (s == null) throw new Error('bufferSeries returned null for a fixture that has a buffer');
  const wf = attributedNet(l);
  if (s.netDays !== wf) {
    throw new Error(
      `bufferSeries is wrong: its day-walk nets ${s.netDays}d of buffer spent, but the waterfall's ` +
      `attributed rows net ${wf}d. A move kind is missing from, or double-counted in, movesOf().`,
    );
  }
  if (s.netDays !== l.usedDays) {
    throw new Error(
      `chainLedger is wrong: bufferSeries and the waterfall both net ${wf}d, but usedDays says ` +
      `${l.usedDays}d — ${(l.usedDays ?? 0) - wf}d of buffer movement that nothing in the schedule ` +
      `explains. (A ±1d residual on a live phase is FORECAST_NOISE_DAYS, not a bug; see the ` +
      `"sub-threshold residual" test.)`,
    );
  }
  expect(s.netDays).toBe(l.usedDays);
  return s;
}

describe('waterfall agreement — the flow and "Where the buffer went" keep one set of books', () => {
  it('balances on a chain with an idle gap, an underrun and a live overrun', () => {
    const l = computeChainLedger(mixed(140));
    const s = expectBooksBalance(l, mixed(140).now);
    // Relational, not literal: the walk's end state IS the ledger's headline buffer.
    expect(s.startBufferDays - s.netDays).toBe(l.bufferDays);
    expect(s.unattributedDays).toBe(0);
  });

  it('balances when the buffer is blown (B₀ smaller than what was spent)', () => {
    const l = computeChainLedger(mixed(105));
    const s = expectBooksBalance(l, mixed(105).now);
    expect(l.bufferDays).toBeLessThan(0);
    expect(s.startBufferDays - s.netDays).toBe(l.bufferDays);
  });

  it('balances when the program is AHEAD (buffer handed back, net negative)', () => {
    const l = computeChainLedger(early);
    const s = expectBooksBalance(l, early.now);
    expect(s.netDays).toBeLessThan(0);
    expect(s.startBufferDays - s.netDays).toBe(l.bufferDays);
  });

  it('reports a sub-threshold residual instead of hiding it', () => {
    // A 1-day live variance is under FORECAST_NOISE_DAYS, so the ledger deliberately
    // attributes nothing — and the waterfall drops its own residual row below ±2d.
    // bufferSeries must not silently reconcile to usedDays: it walks what it can
    // attribute and reports the rest, so the two books stay comparable.
    const l = computeChainLedger(noise);
    const s = bufferSeries(l, noise.now)!;
    expect(l.waterfall).toEqual([]);
    expect(s.moves).toEqual([]);
    expect(s.netDays).toBe(attributedNet(l));
    expect(s.unattributedDays).toBe(l.usedDays);
  });
});

describe('one value per day, unclipped at both ends', () => {
  const input = mixed(140);
  const ledger = computeChainLedger(input);
  const series = bufferSeries(ledger, input.now)!;

  it('runs a point per day from the chain start to the projected finish', () => {
    expect(series.points[0].ms).toBe(day(0));
    expect(series.points[series.points.length - 1].ms).toBe(ledger.projectedFinishMs);
    for (let i = 1; i < series.points.length; i++) {
      expect(series.points[i].ms - series.points[i - 1].ms).toBe(DAY);
    }
  });

  it('starts at B₀ / 100% and ends at the ledger buffer', () => {
    expect(series.points[0].leftDays).toBe(ledger.startBufferDays);
    expect(series.points[0].leftPct).toBe(100);
    expect(series.points[series.points.length - 1].leftDays).toBe(ledger.bufferDays);
  });

  it('marks everything strictly after today as the forecast continuation', () => {
    const at = (ms: number) => series.points.find((p) => p.ms === ms)!;
    expect(at(day(60)).projected).toBe(false);
    expect(at(day(61)).projected).toBe(true);
  });

  it('keeps the forecast draw in the tail, not folded into today', () => {
    // Decision 5: the 7 forecast days are spent between B's plan tick (day 73) and
    // its projected end (day 80), so today still shows the buffer actually in hand.
    const at = (ms: number) => series.points.find((p) => p.ms === ms)!;
    expect(at(day(60)).leftDays).toBeGreaterThan(at(day(79)).leftDays);
    expect(at(day(72)).leftDays).toBe(at(day(60)).leftDays);
    expect(at(day(79)).leftDays).toBe(ledger.bufferDays);
    // and the whole tail is what the waterfall's forecast row claims
    const forecast = ledger.waterfall.filter((w) => w.kind === 'forecast');
    const tail = at(day(72)).leftDays - at(day(79)).leftDays;
    expect(tail).toBe(forecast.reduce((sum, w) => sum + (w.gain ? -w.days : w.days), 0));
  });

  it('ramps an idle gap across the days it leaks, rather than a cliff at one end', () => {
    const at = (ms: number) => series.points.find((p) => p.ms === ms)!;
    // the gap runs day 27 → 33; each idle day costs a day of buffer
    for (let n = 28; n <= 32; n++) {
      expect(at(day(n)).leftDays).toBeLessThan(at(day(n - 1)).leftDays);
    }
    expect(at(day(32)).leftDays).toBe(at(day(40)).leftDays); // and stops when work resumes
  });

  it('goes below 0% when the buffer is blown — no clipping to a 0–100% frame', () => {
    const blown = mixed(105);
    const l = computeChainLedger(blown);
    const s = bufferSeries(l, blown.now)!;
    const last = s.points[s.points.length - 1];
    expect(last.leftDays).toBeLessThan(0);
    expect(last.leftPct).toBeLessThan(0);
    expect(last.leftDays).toBe(l.bufferDays);
    // the day it ran out is in the series, and it is inside the forecast tail
    const ranOut = s.points.find((p) => p.leftDays <= 0)!;
    expect(ranOut).toBeDefined();
    expect(ranOut.projected).toBe(true);
  });

  it('goes above 100% when a phase hands back more than the program started with', () => {
    const l = computeChainLedger(early);
    const s = bufferSeries(l, early.now)!;
    const peak = Math.max(...s.points.map((p) => p.leftPct));
    expect(peak).toBeGreaterThan(100);
    expect(Math.max(...s.points.map((p) => p.leftDays))).toBe(l.bufferDays);
  });
});

describe('no percentage story, no series', () => {
  it('returns null without an SOP', () => {
    const l = computeChainLedger({ ...mixed(140), sopDate: null });
    expect(bufferSeries(l, day(60))).toBeNull();
  });

  it('returns null when the program started with no buffer to be a share of', () => {
    // SOP exactly at the planned finish: B₀ = 0, so "share of B₀" has no value.
    const l = computeChainLedger(mixed(100));
    expect(l.startBufferDays).toBe(0);
    expect(bufferSeries(l, day(60))).toBeNull();
  });

  it('returns null for an empty chain', () => {
    const l = computeChainLedger({ phases: [], sopDate: iso(140), now: day(60) });
    expect(bufferSeries(l, day(60))).toBeNull();
  });
});
