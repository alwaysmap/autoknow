/** @jest-environment node */
// A brief must not sit beside a ledger computing different numbers (#236 finding 6).
// Staleness used to count only NEW ROWS, so a schedule that drifted because time passed
// left the brief looking current and wrong: Ford Evos said "39 days over" next to a
// header computing 17.
//
// The fix is a fingerprint stored on the Summary row and compared against the chain the
// page computes anyway — two points, never the series. These tests pin the comparison,
// which is the whole decision: everything downstream (regenerate on view, sweep in the
// cron) is machinery that already existed.
import {
  chainFingerprint, chainDrifted, parseChainFingerprint, CHAIN_DRIFT_DAYS,
  type ChainFingerprint,
} from '../src/lib/chainFingerprint';
import type { ChainLedgerResult } from '../src/lib/chainLedger';
import { DAY_MS } from '../src/lib/sop';

const FINISH = Date.UTC(2026, 9, 18);

const print = (over: Partial<ChainFingerprint> = {}): ChainFingerprint => ({
  constraintPhaseId: 7,
  focusPhaseId: 9,
  bufferDays: 40,
  projectedFinishMs: FINISH,
  ...over,
});

describe('chainFingerprint reads the four facts that change what a brief says', () => {
  it('takes the ledger’s live constraint, focus phase, buffer and projected finish', () => {
    const ledger = {
      liveConstraintId: 7,
      immediateFocus: { phaseId: 9, phaseName: 'Car Service Integration', overPct: 117, remainingDays: 12, count: 1 },
      bufferDays: 40,
      projectedFinishMs: FINISH,
    } as unknown as ChainLedgerResult;
    expect(chainFingerprint(ledger)).toEqual(print());
  });

  it('carries nulls rather than inventing values when there is no focus or no SOP', () => {
    const ledger = {
      liveConstraintId: null, immediateFocus: null, bufferDays: null, projectedFinishMs: null,
    } as unknown as ChainLedgerResult;
    expect(chainFingerprint(ledger)).toEqual({
      constraintPhaseId: null, focusPhaseId: null, bufferDays: null, projectedFinishMs: null,
    });
  });
});

describe('chainDrifted', () => {
  it('is false with no baseline — an older brief is not stale for predating the column', () => {
    // The ordinary new-content staleness still covers those briefs; treating "no
    // fingerprint" as drift would regenerate every stored brief at once.
    expect(chainDrifted(null, print())).toBe(false);
  });

  it('is false when nothing moved', () => {
    expect(chainDrifted(print(), print())).toBe(false);
  });

  it('fires the moment the constraint or the focus phase CHANGES IDENTITY', () => {
    // Not on the day scale: the brief's subject changed, not its arithmetic.
    expect(chainDrifted(print(), print({ constraintPhaseId: 8 }))).toBe(true);
    expect(chainDrifted(print(), print({ focusPhaseId: 11 }))).toBe(true);
    // Including appearing and disappearing — "a phase is now past its estimate" is the
    // single most consequential change the page can make.
    expect(chainDrifted(print({ focusPhaseId: null }), print())).toBe(true);
    expect(chainDrifted(print(), print({ focusPhaseId: null }))).toBe(true);
  });

  it('tolerates day drift under the threshold and fires at it', () => {
    expect(chainDrifted(print(), print({ bufferDays: 40 - (CHAIN_DRIFT_DAYS - 1) }))).toBe(false);
    expect(chainDrifted(print(), print({ bufferDays: 40 - CHAIN_DRIFT_DAYS }))).toBe(true);
    // Symmetric: buffer handed back is drift too — a brief that says "at risk" beside a
    // page that says "reachable" is the same defect facing the other way.
    expect(chainDrifted(print(), print({ bufferDays: 40 + CHAIN_DRIFT_DAYS }))).toBe(true);
  });

  it('watches the projected finish, which is what drifts when there is no SOP', () => {
    const noSop = print({ bufferDays: null });
    expect(chainDrifted(noSop, { ...noSop, projectedFinishMs: FINISH + (CHAIN_DRIFT_DAYS - 1) * DAY_MS })).toBe(false);
    expect(chainDrifted(noSop, { ...noSop, projectedFinishMs: FINISH + CHAIN_DRIFT_DAYS * DAY_MS })).toBe(true);
  });

  it('treats a number appearing or vanishing as a change, however small', () => {
    // A SOP was set, or the chain finished. Neither is arithmetic drift.
    expect(chainDrifted(print({ bufferDays: null }), print())).toBe(true);
    expect(chainDrifted(print(), print({ bufferDays: null }))).toBe(true);
  });
});

describe('parseChainFingerprint', () => {
  it('reads back what was stored', () => {
    expect(parseChainFingerprint(JSON.parse(JSON.stringify(print())))).toEqual(print());
  });

  it('returns null for anything that is not one, so a bad row means "no verdict"', () => {
    expect(parseChainFingerprint(null)).toBeNull();
    expect(parseChainFingerprint('nope')).toBeNull();
    expect(parseChainFingerprint({})).toBeNull();
    expect(parseChainFingerprint({ constraintPhaseId: 1 })).toBeNull(); // half a shape
  });

  it('coerces non-numeric fields to null rather than trusting them', () => {
    const parsed = parseChainFingerprint({
      constraintPhaseId: 'seven', focusPhaseId: 9, bufferDays: null, projectedFinishMs: FINISH,
    });
    expect(parsed).toEqual({ constraintPhaseId: null, focusPhaseId: 9, bufferDays: null, projectedFinishMs: FINISH });
  });
});
