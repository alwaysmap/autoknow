/** @jest-environment node */
// #148. `chainLedger` has always computed WHY a phase is the constraint — overPct,
// elapsed vs planned, idle days, who is contended — and it reached exactly one screen:
// ChainLedger.tsx, one program at a time. The portfolio panel named WHERE and stopped,
// under a heading promising a diagnosis.
//
// These pin the producer that carries the answer across: that it reads the ledger's own
// Situation packets rather than re-deriving anything, that a clean phase is a real answer
// and not an empty row, that `basis` travels with every number, and that `since` is null
// rather than invented when there is no date to state.
import { computeChainLedger, type LedgerPhaseInput } from '../src/lib/chainLedger';
import { constraintDiagnosis } from '../src/lib/chainInsights';

const DAY = 86_400_000;
const D0 = Date.UTC(2026, 0, 1);
const day = (n: number) => D0 + n * DAY;
const iso = (n: number) => new Date(day(n)).toISOString();

const phase = (
  id: number, forecastedDuration: number, progress: number,
  parentIds: number[] = [], startedAt: string | null = null, completedAt: string | null = null,
): LedgerPhaseInput => ({ id, name: `P${id}`, forecastedDuration, progress, parentIds, startedAt, completedAt });

const CTX = { programId: 7, programName: 'Meridian Van GAS' };
const diagnose = (...args: Parameters<typeof computeChainLedger>) =>
  constraintDiagnosis(computeChainLedger(...args), CTX);

describe('constraintDiagnosis', () => {
  it('says the phase is over its own estimate, and marks the number as estimate-derived', () => {
    // Started 60 days ago against a 40-day estimate, half done → 80 against 40: +100%.
    const d = diagnose({ phases: [phase(1, 40, 50, [], iso(-60))], sopDate: iso(700), now: day(0) })!;
    expect(d.symptom.key).toBe('cdOverrun');
    expect(d.symptom.values).toMatchObject({ program: 'Meridian Van GAS', pct: 100, p: 40, r: 20 });
    // `overPct` is a share of a typed-in forecastedDuration, so the number is over a
    // GUESS however precisely it prints — the whole reason `basis` exists.
    expect(d.symptom.basis).toBe('estimated');
    expect(d.severity).toBe('act');
    expect(d.symptom.measure).toBe(100);
    expect(d.since).toBe(iso(-60));
    expect(d.href).toBe('/programs/7#phase-1');
    expect(d.scope).toEqual({ kind: 'phase', id: 1, name: 'P1', programId: 7 });
  });

  it('says the baton landed and nobody picked it up, measured from real dates', () => {
    const d = diagnose({
      phases: [phase(1, 30, 100, [], iso(0), iso(30)), phase(2, 30, 0, [1])],
      sopDate: iso(120), now: day(56),
    })!;
    expect(d.symptom.key).toBe('cdIdle');
    expect(d.symptom.values).toMatchObject({ d: 26 });
    // Two real dates subtracted — not a comparison against anything anybody typed in.
    expect(d.symptom.basis).toBe('measured');
    expect(d.severity).toBe('act');
    // SINCE is when the baton landed, which is the day the waiting started.
    expect(d.since).toBe(iso(30));
  });

  it('says nothing is wrong when nothing is wrong, rather than dropping the row', () => {
    const d = diagnose({
      phases: [phase(1, 30, 100, [], iso(0), iso(30)), phase(2, 40, 50, [1], iso(30))],
      sopDate: iso(140), now: day(40),
    })!;
    // Structural-and-fine is a legitimate answer. Dropping it would overstate the
    // portfolio — every remaining row would read as trouble.
    expect(d.symptom.key).toBe('cdClear');
    expect(d.severity).toBe('clear');
    expect(d.symptom.measure).toBeNull();
    expect(d.action).toBeNull();
    expect(d.since).toBe(iso(30));
  });

  it('reports the WORST diagnosis when a phase has more than one thing wrong', () => {
    // The constraint is both overrunning and contended. 'act' beats 'watch'.
    const d = diagnose({
      phases: [phase(1, 40, 50, [], iso(-60))],
      sopDate: iso(700), now: day(0),
      resources: [{
        kind: 'person', id: 3, name: 'Priya Sharma', phaseId: 1,
        otherPrograms: [{ programId: 9, programName: 'Nova', bufferDays: 40 }],
      }],
    })!;
    expect(d.symptom.key).toBe('cdOverrun');
    expect(d.severity).toBe('act');
  });

  it('names the contended resource when that is the only thing wrong', () => {
    const d = diagnose({
      phases: [phase(1, 30, 100, [], iso(0), iso(30)), phase(2, 40, 50, [1], iso(30))],
      sopDate: iso(140), now: day(40),
      resources: [{
        kind: 'person', id: 3, name: 'Priya Sharma', phaseId: 2,
        otherPrograms: [
          { programId: 9, programName: 'Nova', bufferDays: 40 },
          { programId: 10, programName: 'Stellantis', bufferDays: -3 },
        ],
      }],
    })!;
    expect(d.symptom.key).toBe('cdContended');
    expect(d.symptom.values).toMatchObject({ name: 'Priya Sharma', n: 2 });
    expect(d.severity).toBe('watch');
    expect(d.symptom.measure).toBe(2);
  });

  it('never dates a phase that has not started', () => {
    // The chain's next step is unstarted and nothing is idle behind it, so there is no
    // day to name. `since: null` is the answer; a first-seen timestamp would be fiction.
    const d = diagnose({ phases: [phase(1, 30, 0), phase(2, 30, 0, [1])], sopDate: iso(80), now: day(0) })!;
    expect(d.since).toBeNull();
  });

  it('returns null when the program has no live constraint at all', () => {
    const r = computeChainLedger({
      phases: [phase(1, 30, 100, [], iso(0), iso(30))],
      sopDate: iso(140), now: day(40),
    });
    expect(r.liveConstraintId).toBeNull();
    expect(constraintDiagnosis(r, CTX)).toBeNull();
  });

  it('never describes a FINISHED phase — a sunk overrun is not the live constraint', () => {
    // P1 blew its estimate and finished; P2 is the live constraint and is fine. The row
    // must describe P2, or it names one phase and diagnoses another.
    const d = diagnose({
      phases: [phase(1, 20, 100, [], iso(0), iso(40)), phase(2, 40, 50, [1], iso(40))],
      sopDate: iso(200), now: day(60),
    })!;
    expect(d.scope).toMatchObject({ id: 2 });
    expect(d.symptom.key).not.toBe('cdOverrun');
  });
});
