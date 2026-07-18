import { resolvePerson, type PersonLike } from '../src/lib/people';

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
