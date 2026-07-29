// The schedule a brief was written against, small enough to store on the Summary row.
// Pure and client-safe, like lib/criticalChain and lib/chainLedger.
//
// Why a fingerprint and not a re-read (#236 finding 6): a brief must not sit beside a
// ledger computing different numbers — Ford Evos' brief said "39 days over" next to a
// header computing 17, and Qualcomm's said "miss by ~12" next to 5. Staleness only
// counted NEW ROWS (a state filed, a document ingested), so a schedule that drifted
// because time passed left the brief looking current and wrong.
//
// The drift is DECIDED, never displayed: there is no reason to show a reader that two
// numbers on their screen disagree when the honest answer is to refresh the older one.
// Marking the brief stale is enough — `SummaryPanel`'s mount effect regenerates a stale
// brief on view and `runSummaryCycle` sweeps stale targets, so this needs no new UI.
//
// It reads NO history. The fields come from the ledger the program page computes for its
// own render, compared against a small JSON on the Summary row — two points, never the
// series (#236's scaling constraint, pattern 1).

import type { ChainLedgerResult } from './chainLedger';
import { DAY_MS } from './sop';

/**
 * What a brief's schedule looked like when it was generated. Four facts, chosen because
 * each one changes what the brief SAYS: which phase is the constraint, which phase the
 * program should act on today, how much buffer is left, and when the chain now lands.
 */
export interface ChainFingerprint {
  /** The live constraint — the first unfinished phase on the longest-remaining path. */
  constraintPhaseId: number | null;
  /** The phase past its OWN estimate by enough to be the thing to act on, if any. This
   *  and `constraintPhaseId` are the two facts the page called "constraint" in one
   *  breath; they are separate fields here so a change to either is visible. */
  focusPhaseId: number | null;
  /** Days between the projected finish and the SOP; null with no SOP target. */
  bufferDays: number | null;
  /** Projected finish, in ms. Carries the drift when there is no SOP to measure against. */
  projectedFinishMs: number | null;
}

/**
 * How far the day numbers may move before the brief is considered to be arguing with the
 * page. A running phase's forecast finish advances with the clock, so this is in effect
 * "regenerate at most every N days when nothing else changes" — the whole portfolio is
 * eleven programs, so at a week that is ~1.6 regenerations a day, comfortably inside the
 * cycle allowance (lib/ingestBudget). Identity changes (a different constraint, a new
 * focus phase) are not on this scale and mark stale immediately: the brief's SUBJECT
 * changed, not its arithmetic.
 */
export const CHAIN_DRIFT_DAYS = 7;

export function chainFingerprint(ledger: ChainLedgerResult): ChainFingerprint {
  return {
    constraintPhaseId: ledger.liveConstraintId,
    focusPhaseId: ledger.immediateFocus?.phaseId ?? null,
    bufferDays: ledger.bufferDays,
    projectedFinishMs: ledger.projectedFinishMs,
  };
}

/** A stored fingerprint, read back off a `Summary.chainFingerprint` JSON column. Returns
 *  null for anything that is not one — a brief generated before this shipped carries
 *  none, and an absent baseline means "no drift verdict", never "drifted". */
export function parseChainFingerprint(value: unknown): ChainFingerprint | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  // All four, not a sample: every one is always written, so a partial object is a bug
  // or someone else's JSON — either way not a baseline to judge drift against.
  const keys = ['constraintPhaseId', 'focusPhaseId', 'bufferDays', 'projectedFinishMs'];
  if (!keys.every((k) => k in v)) return null;
  return {
    constraintPhaseId: num(v.constraintPhaseId),
    focusPhaseId: num(v.focusPhaseId),
    bufferDays: num(v.bufferDays),
    projectedFinishMs: num(v.projectedFinishMs),
  };
}

/** Did one number appear, disappear, or move by `driftDays`? A null↔value transition is a
 *  real change (a SOP was set; a chain finished) and counts however small the number is. */
const moved = (a: number | null, b: number | null, drift: number): boolean => {
  if (a == null || b == null) return a !== b;
  return Math.abs(a - b) >= drift;
};

/**
 * Has the schedule moved out from under this brief? `stored` is what the brief was
 * written against, `current` is what the page computes now. No baseline ⇒ false: an
 * older brief is not stale merely for predating the fingerprint, and the ordinary
 * new-content staleness still covers it.
 */
export function chainDrifted(
  stored: ChainFingerprint | null,
  current: ChainFingerprint,
  driftDays: number = CHAIN_DRIFT_DAYS,
): boolean {
  if (!stored) return false;
  if (stored.constraintPhaseId !== current.constraintPhaseId) return true;
  if (stored.focusPhaseId !== current.focusPhaseId) return true;
  if (moved(stored.bufferDays, current.bufferDays, driftDays)) return true;
  return moved(stored.projectedFinishMs, current.projectedFinishMs, driftDays * DAY_MS);
}
