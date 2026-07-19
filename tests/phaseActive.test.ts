import { isPhaseActive, statusProgress } from '../src/lib/phase';

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
