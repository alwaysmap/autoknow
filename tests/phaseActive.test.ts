import { isPhaseActive, statusProgress, effectiveStartedAt } from '../src/lib/phase';

// The Active toggle: a phase is in progress once work has BEGUN — explicitly marked
// or implied by hill movement — so cycle-time clocks don't wait for the first update.
describe('isPhaseActive', () => {
  it('not started: no progress, no marker', () => expect(isPhaseActive(0, null)).toBe(false));
  it('explicitly started with zero progress IS active', () => expect(isPhaseActive(0, '2026-07-12T00:00:00Z')).toBe(true));
  it('progress alone implies active', () => expect(isPhaseActive(40, null)).toBe(true));
  it('done is not active, marker or not', () => {
    expect(isPhaseActive(100, null)).toBe(false);
    expect(isPhaseActive(100, '2026-07-12T00:00:00Z')).toBe(false);
  });
});

describe('statusProgress', () => {
  it('explicitly-started zero-progress reads as In Progress', () => expect(statusProgress(0, '2026-07-12T00:00:00Z')).toBeGreaterThan(0));
  it('unstarted zero stays Not Started', () => expect(statusProgress(0, null)).toBe(0));
  it('real progress passes through', () => expect(statusProgress(60, '2026-07-12T00:00:00Z')).toBe(60));
});

// A user must be able to take an in-flight phase BACK to Not Started (drag the dot to
// 0, clear the "started on" claim). Before the gate, the derived first-progress date
// pinned the phase "started" forever — you can't delete append-only history.
describe('effectiveStartedAt — a premature start can be retracted', () => {
  const first = '2026-06-10';

  it('explicit claim always wins, even at 0% (the Active toggle)', () => {
    expect(effectiveStartedAt('2026-07-01', 0, first)).toBe('2026-07-01');
    expect(effectiveStartedAt('2026-07-01', 40, first)).toBe('2026-07-01');
  });

  it('derives from first progress WHILE still in flight', () => {
    expect(effectiveStartedAt(null, 40, first)).toBe(first);
    expect(effectiveStartedAt(null, 100, first)).toBe(first); // done phases stay started
  });

  it('retracts to Not Started at 0% with no explicit claim, despite prior progress', () => {
    // The phase was worked (has a first-progress date) but was dragged back to 0 and
    // the explicit claim cleared — it now reads Not Started.
    expect(effectiveStartedAt(null, 0, first)).toBeNull();
    expect(isPhaseActive(0, effectiveStartedAt(null, 0, first))).toBe(false);
  });

  it('a never-touched phase is Not Started', () => {
    expect(effectiveStartedAt(null, 0, null)).toBeNull();
  });
});
