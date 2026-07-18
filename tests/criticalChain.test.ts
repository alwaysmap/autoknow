import { computeCriticalChain, remainingDays, type ChainPhase } from '../src/lib/criticalChain';

const phase = (id: number, forecastedDuration: number, progress: number, parentIds: number[] = []): ChainPhase => ({
  id, name: `P${id}`, forecastedDuration, progress, parentIds,
});

describe('remainingDays', () => {
  it('scales duration by the unfinished fraction and clamps progress', () => {
    expect(remainingDays({ forecastedDuration: 20, progress: 0 })).toBe(20);
    expect(remainingDays({ forecastedDuration: 20, progress: 50 })).toBe(10);
    expect(remainingDays({ forecastedDuration: 20, progress: 100 })).toBe(0);
    expect(remainingDays({ forecastedDuration: 20, progress: 150 })).toBe(0); // clamp high
    expect(remainingDays({ forecastedDuration: 20, progress: -10 })).toBe(20); // clamp low
  });
});

describe('computeCriticalChain', () => {
  it('returns an empty chain for no phases', () => {
    expect(computeCriticalChain([])).toEqual({ path: [], edgeKeys: new Set(), remainingDays: 0, constraintId: null });
  });

  it('returns an empty chain when everything is finished', () => {
    const chain = computeCriticalChain([phase(1, 10, 100), phase(2, 10, 100, [1])]);
    expect(chain.path).toEqual([]);
    expect(chain.remainingDays).toBe(0);
    expect(chain.constraintId).toBeNull();
  });

  it('picks the longest remaining-duration path, not the longest by count', () => {
    // 1 → 2 (short) and 1 → 3 → 4 (long). Chain must be the heavier branch.
    const chain = computeCriticalChain([
      phase(1, 10, 0),
      phase(2, 50, 0, [1]),          // 1→2 = 60 days over 2 phases
      phase(3, 5, 0, [1]),
      phase(4, 5, 0, [3]),           // 1→3→4 = 20 days over 3 phases
    ]);
    expect(chain.path).toEqual([1, 2]);
    expect(chain.remainingDays).toBe(60);
    expect(chain.edgeKeys.has('1-2')).toBe(true);
    expect(chain.constraintId).toBe(1);
  });

  it('names the first unfinished phase as the constraint', () => {
    const chain = computeCriticalChain([
      phase(1, 20, 100),             // done — on the path but not the constraint
      phase(2, 40, 30, [1]),
      phase(3, 30, 0, [2]),
    ]);
    expect(chain.path).toEqual([1, 2, 3]);
    expect(chain.constraintId).toBe(2);
  });

  it('is defensive against cycles in invalid data', () => {
    const chain = computeCriticalChain([
      phase(1, 10, 0, [2]),
      phase(2, 10, 0, [1]),
    ]);
    // must terminate and produce a bounded result, not hang
    expect(chain.remainingDays).toBeGreaterThanOrEqual(0);
  });

  it('handles a diamond (converging branches)', () => {
    const chain = computeCriticalChain([
      phase(1, 10, 0),
      phase(2, 30, 0, [1]),
      phase(3, 5, 0, [1]),
      phase(4, 10, 0, [2, 3]),       // heavier route is 1→2→4 = 50
    ]);
    expect(chain.path).toEqual([1, 2, 4]);
    expect(chain.remainingDays).toBe(50);
  });
});
