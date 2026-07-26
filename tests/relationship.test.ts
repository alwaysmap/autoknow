import {
  clampScore, parseScore, deriveScore, scoreToHealth, relationshipMix,
  relScoreLabel, EVIDENCE_LOCALE, RELATIONSHIP_HISTORY_HASH, relUpdateHash,
  parseRelUpdateHash, isRelationshipHash, REL_SCORES,
} from '../src/lib/relationship';
import { relationshipUpdateHref } from '../src/lib/entityHref';

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

// The ONE numeric → qualitative-word mapping (#111). A leadership brief reads
// "Steady"; "3/5" is an internal coordinate leaking into prose.
describe('relScoreLabel', () => {
  test('every point on the scale has a word, and none of them is a number', () => {
    expect(REL_SCORES.map((s) => relScoreLabel('en', s))).toEqual([
      'Critical', 'Strained', 'Steady', 'Strong', 'Exemplary',
    ]);
    for (const s of REL_SCORES) {
      expect(relScoreLabel(EVIDENCE_LOCALE, s)).not.toMatch(/\d/);
    }
  });

  test('no reading is its own word, never a mid-scale guess', () => {
    expect(relScoreLabel('en', null)).toBe('Not rated');
    // The trap #129 closed: an unrated partner must not read as a deliberate 3.
    expect(relScoreLabel('en', null)).not.toBe(relScoreLabel('en', 3));
  });

  test('the word is localized, not hard-coded English', () => {
    expect(relScoreLabel('de', 3)).toBe('Stabil');
    expect(relScoreLabel('ja', 5)).toBe('模範的');
    expect(relScoreLabel('ko', 1)).toBe('위기');
  });

  test('evidence handed to the model is written in English', () => {
    // The brief is generated once and read by everyone, so the evidence locale is
    // fixed rather than inherited from whoever triggered the regeneration.
    expect(EVIDENCE_LOCALE).toBe('en');
  });
});

// Partner health is hash-addressable, exactly as phases and program status are: the
// popover IS a URL, and a reference to ONE update carries the fragment that opens it.
describe('partner-health deep-link fragments', () => {
  test('the log and one update share a prefix but never match each other', () => {
    expect(relUpdateHash(42)).toBe('relationship-update-42');
    expect(relUpdateHash(42).startsWith('relationship-')).toBe(true);
    expect(parseRelUpdateHash(`#${RELATIONSHIP_HISTORY_HASH}`)).toBeNull();
  });

  test('parseRelUpdateHash reads the id with or without the #, and rejects junk', () => {
    expect(parseRelUpdateHash('#relationship-update-7')).toBe(7);
    expect(parseRelUpdateHash('relationship-update-7')).toBe(7);
    expect(parseRelUpdateHash('#relationship-update-')).toBeNull();
    expect(parseRelUpdateHash('#relationship-update-abc')).toBeNull();
    expect(parseRelUpdateHash('#phase-7-detail')).toBeNull();
    // Must not swallow a neighbouring section anchor on the same page.
    expect(parseRelUpdateHash('#activity')).toBeNull();
  });

  test('isRelationshipHash recognizes both members and nothing else', () => {
    expect(isRelationshipHash('#relationship-history')).toBe(true);
    expect(isRelationshipHash('#relationship-update-3')).toBe(true);
    // Both members accept the bare form too, so the family answers consistently
    // whether it is handed `location.hash` or a fragment sliced out of an href.
    expect(isRelationshipHash('relationship-history')).toBe(true);
    expect(isRelationshipHash('relationship-update-3')).toBe(true);
    expect(isRelationshipHash('#status-history')).toBe(false);
    expect(isRelationshipHash('#phase-3-detail')).toBe(false);
    expect(isRelationshipHash('')).toBe(false);
  });

  test('the href hangs the fragment off the one partner route', () => {
    expect(relationshipUpdateHref(13, 42)).toBe('/partners/13#relationship-update-42');
    // Round-trip: a link built here is a link the popover can resolve.
    expect(parseRelUpdateHash(relationshipUpdateHref(13, 42).split('#')[1])).toBe(42);
  });
});
