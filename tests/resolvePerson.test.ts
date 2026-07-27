import { resolvePerson, resolvePersonCandidates, type PersonLike } from '../src/lib/people';

const people: PersonLike[] = [
  { id: 1, name: 'Joanne Smith', email: 'joanne@google.com' },
  { id: 2, name: 'Jo Tanaka', email: 'jo@partner.com' },
  { id: 3, name: 'Kenji Sato', email: 'kenji@denso.co.jp' },
];

describe('resolvePerson', () => {
  it('returns null for empty input', () => {
    expect(resolvePerson(people, null)).toBeNull();
    expect(resolvePerson(people, '')).toBeNull();
    expect(resolvePerson(people, '@')).toBeNull();
  });

  it('matches on an exact full email', () => {
    expect(resolvePerson(people, 'kenji@denso.co.jp')?.id).toBe(3);
  });

  it('matches on the email local-part via a handle', () => {
    expect(resolvePerson(people, '@jo')?.id).toBe(2);
    expect(resolvePerson(people, 'jo')?.id).toBe(2);
  });

  it('does NOT substring-match (the bug this module fixed)', () => {
    // 'jo' must resolve to Jo (local-part), never to Joanne by substring.
    expect(resolvePerson(people, 'jo')?.id).toBe(2);
    // a handle that matches nobody's local-part or exact name is null, not a
    // substring hit on 'Joanne'.
    expect(resolvePerson(people, 'joa')).toBeNull();
  });

  it('falls back to an exact case-insensitive full name', () => {
    expect(resolvePerson(people, 'kenji sato')?.id).toBe(3);
    expect(resolvePerson(people, 'KENJI SATO')?.id).toBe(3);
  });

  it('prefers email over name when both could match different people', () => {
    const ambiguous: PersonLike[] = [
      { id: 10, name: 'jo', email: 'someone@x.com' },   // name == handle
      { id: 11, name: 'Jo Real', email: 'jo@x.com' },   // local-part == handle
    ];
    // local-part match ranks above the exact-name match
    expect(resolvePerson(ambiguous, 'jo')?.id).toBe(11);
  });
});

// The same three tiers, asked for the whole answer instead of the first one. This is
// what lets a ONE-SHOT backfill tell "one person" from "I picked one of two" — see
// src/lib/ownerBackfill.ts.
describe('resolvePersonCandidates', () => {
  it('is empty when nothing matches, at any tier', () => {
    expect(resolvePersonCandidates(people, null)).toEqual([]);
    expect(resolvePersonCandidates(people, '')).toEqual([]);
    expect(resolvePersonCandidates(people, 'joa')).toEqual([]);
  });

  it('returns exactly one for an unambiguous match at each tier', () => {
    expect(resolvePersonCandidates(people, 'kenji@denso.co.jp').map((p) => p.id)).toEqual([3]);
    expect(resolvePersonCandidates(people, '@jo').map((p) => p.id)).toEqual([2]);
    expect(resolvePersonCandidates(people, 'KENJI SATO').map((p) => p.id)).toEqual([3]);
  });

  it('returns BOTH when a local part is shared across domains', () => {
    // Both at PARTNER domains on purpose: a bare handle derives to the org domain
    // (`deriveEmail`), so 'alice' would match an alice@google.com exactly and never
    // reach the local-part tier. Ambiguity here is a partner-side fact.
    const sharedLocalPart: PersonLike[] = [
      { id: 20, name: 'Alice Waters', email: 'alice@bosch.com' },
      { id: 21, name: 'Alice Brown', email: 'alice@qualcomm.com' },
    ];
    // 'alice' alone cannot name one of them. resolvePerson picks the first; this says so.
    expect(resolvePersonCandidates(sharedLocalPart, 'alice').map((p) => p.id)).toEqual([20, 21]);
    expect(resolvePerson(sharedLocalPart, 'alice')?.id).toBe(20);
  });

  it('returns BOTH when two people share a name', () => {
    const namesakes: PersonLike[] = [
      { id: 30, name: 'Chris Lee', email: 'clee@google.com' },
      { id: 31, name: 'Chris Lee', email: 'chrisl@google.com' },
    ];
    expect(resolvePersonCandidates(namesakes, 'chris lee').map((p) => p.id)).toEqual([30, 31]);
  });

  it('stops at the FIRST tier that matches — a lower tier never joins the answer', () => {
    const mixed: PersonLike[] = [
      { id: 40, name: 'jo', email: 'someone@x.com' }, // name == handle
      { id: 41, name: 'Jo Real', email: 'jo@x.com' }, // local-part == handle
    ];
    expect(resolvePersonCandidates(mixed, 'jo').map((p) => p.id)).toEqual([41]);
  });

  it('agrees with resolvePerson on its first element, always', () => {
    for (const input of ['kenji@denso.co.jp', 'jo', 'joa', 'KENJI SATO', '', '@']) {
      expect(resolvePerson(people, input)).toBe(resolvePersonCandidates(people, input)[0] ?? null);
    }
  });
});
