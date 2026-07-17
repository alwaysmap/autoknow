import { clampScore, parseScore, deriveScore, scoreToHealth } from '../src/lib/relationship';

// The 7-point relationship scale (lib/relationship): scores clamp to 1..7, legacy
// health-only rows derive a sensible position, and theNeedle stays derivable from a
// score so feed/filters remain coherent.

describe('relationship scale', () => {
  test('clampScore bounds and rounds', () => {
    expect(clampScore(0)).toBe(1);
    expect(clampScore(9)).toBe(7);
    expect(clampScore(4.6)).toBe(5);
  });

  test('parseScore accepts strings/numbers and rejects junk', () => {
    expect(parseScore('3')).toBe(3);
    expect(parseScore(7)).toBe(7);
    expect(parseScore('12')).toBe(7); // clamped
    expect(parseScore('')).toBeNull();
    expect(parseScore(null)).toBeNull();
    expect(parseScore('abc')).toBeNull();
  });

  test('scoreToHealth keeps the derived needle coherent', () => {
    expect(scoreToHealth(7)).toBe('On Track');
    expect(scoreToHealth(6)).toBe('On Track');
    expect(scoreToHealth(5)).toBe('Some Risk');
    expect(scoreToHealth(3)).toBe('Some Risk');
    expect(scoreToHealth(2)).toBe('Concerned');
    expect(scoreToHealth(1)).toBe('Concerned');
  });

  test('deriveScore prefers the stored score', () => {
    expect(deriveScore({ relationshipScore: 2, theNeedle: 'On Track' })).toBe(2);
  });

  test('deriveScore maps legacy health-only rows (incl. legacy risk labels)', () => {
    expect(deriveScore({ relationshipScore: null, theNeedle: 'On Track' })).toBe(6);
    expect(deriveScore({ relationshipScore: null, theNeedle: 'Some Risk' })).toBe(4);
    expect(deriveScore({ relationshipScore: null, theNeedle: 'Concerned' })).toBe(2);
    expect(deriveScore({ relationshipScore: null, theNeedle: 'Low' })).toBe(6);
    expect(deriveScore({ relationshipScore: null, theNeedle: 'Critical' })).toBe(2);
  });
});
