import { clampScore, parseScore, deriveScore, scoreToHealth, relationshipMix } from '../src/lib/relationship';

// The 5-point relationship scale (lib/relationship): scores clamp to 1..5, rows from
// the brief 7-point era and health-only legacy rows both derive sensible positions,
// and theNeedle stays derivable from a score so feed/filters remain coherent.

describe('relationship scale', () => {
  test('clampScore bounds and rounds', () => {
    expect(clampScore(0)).toBe(1);
    expect(clampScore(9)).toBe(5);
    expect(clampScore(3.6)).toBe(4);
  });

  test('parseScore accepts strings/numbers, maps 7-point-era values, rejects junk', () => {
    expect(parseScore('3')).toBe(3);
    expect(parseScore(5)).toBe(5);
    expect(parseScore(6)).toBe(4); // era mapping: Strong stays Strong
    expect(parseScore(7)).toBe(5); // era mapping: Exemplary stays Exemplary
    expect(parseScore('')).toBeNull();
    expect(parseScore(null)).toBeNull();
    expect(parseScore('abc')).toBeNull();
  });

  test('scoreToHealth keeps the derived needle coherent', () => {
    expect(scoreToHealth(5)).toBe('On Track');
    expect(scoreToHealth(4)).toBe('On Track');
    expect(scoreToHealth(3)).toBe('Some Risk');
    expect(scoreToHealth(2)).toBe('Some Risk');
    expect(scoreToHealth(1)).toBe('Concerned');
  });

  test('deriveScore prefers the stored score', () => {
    expect(deriveScore({ relationshipScore: 2, theNeedle: 'On Track' })).toBe(2);
  });

  test('deriveScore maps legacy health-only rows (incl. legacy risk labels)', () => {
    expect(deriveScore({ relationshipScore: null, theNeedle: 'On Track' })).toBe(4);
    expect(deriveScore({ relationshipScore: null, theNeedle: 'Some Risk' })).toBe(3);
    expect(deriveScore({ relationshipScore: null, theNeedle: 'Concerned' })).toBe(2);
    expect(deriveScore({ relationshipScore: null, theNeedle: 'Low' })).toBe(4);
    expect(deriveScore({ relationshipScore: null, theNeedle: 'Critical' })).toBe(2);
  });
});

// The ecosystem relationship-mix bar (design.md §1): shares over RATED partners, with
// unrated ones kept out of the denominator and reported separately.
describe('relationshipMix', () => {
  test('always returns the five slots in scale order, zero-count included', () => {
    const { buckets } = relationshipMix([3, 3]);
    expect(buckets.map((b) => b.score)).toEqual([1, 2, 3, 4, 5]);
    expect(buckets.map((b) => b.count)).toEqual([0, 0, 2, 0, 0]);
  });

  test('shares are of rated partners only; unrated are counted apart', () => {
    const { buckets, rated, unrated } = relationshipMix([1, 5, 5, null, undefined, '']);
    expect(rated).toBe(3);
    expect(unrated).toBe(3);
    expect(buckets.find((b) => b.score === 1)!.share).toBeCloseTo(1 / 3);
    expect(buckets.find((b) => b.score === 5)!.share).toBeCloseTo(2 / 3);
    // Shares sum to 1 — it is a 100% bar or it is lying.
    expect(buckets.reduce((n, b) => n + b.share, 0)).toBeCloseTo(1);
  });

  test('normalizes 7-point-era scores into the 5-point slots', () => {
    const { buckets } = relationshipMix([6, 7]);
    expect(buckets.find((b) => b.score === 4)!.count).toBe(1);
    expect(buckets.find((b) => b.score === 5)!.count).toBe(1);
  });

  test('an entirely unrated book yields zero shares, not NaN', () => {
    const { buckets, rated } = relationshipMix([null, null]);
    expect(rated).toBe(0);
    expect(buckets.every((b) => b.share === 0)).toBe(true);
  });
});
