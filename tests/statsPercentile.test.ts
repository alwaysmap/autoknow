import { percentile } from '../src/lib/stats';

describe('percentile', () => {
  it('returns 0 for an empty array (never NaN or out-of-range)', () => {
    expect(percentile([], 0.5)).toBe(0);
  });

  it('sorts defensively — order of input does not matter', () => {
    expect(percentile([5, 1, 3, 2, 4], 0.5)).toBe(percentile([1, 2, 3, 4, 5], 0.5));
  });

  it('uses nearest-rank', () => {
    const v = [1, 2, 3, 4, 5];
    expect(percentile(v, 0.5)).toBe(3); // ceil(0.5*5)=3 → index 2
    expect(percentile(v, 0.85)).toBe(5); // ceil(0.85*5)=5 → index 4
    expect(percentile(v, 0.95)).toBe(5);
  });

  it('clamps the index for a single-element array', () => {
    expect(percentile([7], 0.95)).toBe(7);
    expect(percentile([7], 0)).toBe(7);
  });

  it('never reads past the end at p = 1', () => {
    expect(percentile([1, 2, 3], 1)).toBe(3);
  });
});
