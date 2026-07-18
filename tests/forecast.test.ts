import { runMonteCarlo } from '../src/lib/forecast';

describe('runMonteCarlo', () => {
  it('returns all-zero for a project with no remaining phases', () => {
    expect(runMonteCarlo(0, 42)).toEqual({ p50: 0, p85: 0, p95: 0 });
  });

  it('is deterministic given the same seed (stable SSR renders)', () => {
    expect(runMonteCarlo(5, 123)).toEqual(runMonteCarlo(5, 123));
  });

  it('produces a monotone p50 <= p85 <= p95', () => {
    const f = runMonteCarlo(6, 7);
    expect(f.p50).toBeLessThanOrEqual(f.p85);
    expect(f.p85).toBeLessThanOrEqual(f.p95);
  });

  it('scales the median with the number of remaining phases', () => {
    // Each phase centers on ~12 days; more phases → larger totals.
    const few = runMonteCarlo(2, 99).p50;
    const many = runMonteCarlo(10, 99).p50;
    expect(many).toBeGreaterThan(few);
  });

  it('respects the 3-day-per-phase floor (never below 3 × phases)', () => {
    const f = runMonteCarlo(4, 5);
    expect(f.p50).toBeGreaterThanOrEqual(12); // 4 phases × 3-day floor
  });
});
