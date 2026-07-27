import { resolvePerson, resolvePersonCandidates, type PersonLike } from '../src/lib/people';

/**
 * A directory entry. `held` is the addresses of the person's OTHER employment periods
 * (#127 E8) — spelled as a trailing argument so the pre-E8 cases below still read as
 * "a person is an id, a name and an address", and the cases that are ABOUT held
 * addresses are the ones that mention them.
 *
 * A period with no address recorded is a real row with a null `email`, so one is always
 * present: every tier has to skip it rather than match '' or throw.
 */
const person = (id: number, name: string, email: string, ...held: string[]): PersonLike => ({
  id,
  name,
  email,
  affiliations: [...held.map((e) => ({ email: e })), { email: null }],
});

const people: PersonLike[] = [
  person(1, 'Joanne Smith', 'joanne@google.com'),
  person(2, 'Jo Tanaka', 'jo@partner.com'),
  person(3, 'Kenji Sato', 'kenji@denso.co.jp'),
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
      person(10, 'jo', 'someone@x.com'),  // name == handle
      person(11, 'Jo Real', 'jo@x.com'),  // local-part == handle
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
      person(20, 'Alice Waters', 'alice@bosch.com'),
      person(21, 'Alice Brown', 'alice@qualcomm.com'),
    ];
    // 'alice' alone cannot name one of them. resolvePerson picks the first; this says so.
    expect(resolvePersonCandidates(sharedLocalPart, 'alice').map((p) => p.id)).toEqual([20, 21]);
    expect(resolvePerson(sharedLocalPart, 'alice')?.id).toBe(20);
  });

  it('returns BOTH when two people share a name', () => {
    const namesakes: PersonLike[] = [
      person(30, 'Chris Lee', 'clee@google.com'),
      person(31, 'Chris Lee', 'chrisl@google.com'),
    ];
    expect(resolvePersonCandidates(namesakes, 'chris lee').map((p) => p.id)).toEqual([30, 31]);
  });

  it('stops at the FIRST tier that matches — a lower tier never joins the answer', () => {
    const mixed: PersonLike[] = [
      person(40, 'jo', 'someone@x.com'), // name == handle
      person(41, 'Jo Real', 'jo@x.com'), // local-part == handle
    ];
    expect(resolvePersonCandidates(mixed, 'jo').map((p) => p.id)).toEqual([41]);
  });

  it('agrees with resolvePerson on its first element, always', () => {
    for (const input of ['kenji@denso.co.jp', 'jo', 'joa', 'KENJI SATO', '', '@']) {
      expect(resolvePerson(people, input)).toBe(resolvePersonCandidates(people, input)[0] ?? null);
    }
  });
});

// #127 E8 / spec #124 Class 4. The seeded Alice Waters is the case in prose: Bosch
// (2022–24) → Qualcomm (2024–26) → Google (now), a new address at each. Before this,
// `awaters@qualcomm.com` on a 2025 action item matched no Person at all and the item
// stranded off the only human it could mean.
describe('historical addresses', () => {
  const alice = person(
    50, 'Alice Waters', 'alice.waters@google.com',
    'alice.waters@bosch.com', 'awaters@qualcomm.com',
  );
  const career: PersonLike[] = [alice, person(51, 'Alice Brown', 'abrown@honda.com')];

  it('resolves an address the person has LEFT — the Class 4 defect', () => {
    expect(resolvePerson(career, 'awaters@qualcomm.com')?.id).toBe(50);
    expect(resolvePerson(career, 'alice.waters@bosch.com')?.id).toBe(50);
  });

  it('resolves a bare handle from a former address, via the local-part tier', () => {
    // 'awaters' derives to awaters@google.com, which nobody holds — so the answer has
    // to come from the local part of an address she no longer uses.
    expect(resolvePerson(career, 'awaters')?.id).toBe(50);
  });

  it('still resolves the CURRENT address, and the current tier still wins', () => {
    expect(resolvePerson(career, 'alice.waters@google.com')?.id).toBe(50);
    expect(resolvePersonCandidates(career, 'alice.waters@google.com').map((p) => p.id))
      .toEqual([50]);
  });

  it('skips periods with no address recorded rather than matching them', () => {
    // Every fixture above carries a `{ email: null }` period. An empty input is already
    // rejected up front, so the risk is a null reaching the tiers as '' — which would
    // make '@' or a domain-less string match everybody.
    expect(resolvePersonCandidates(career, '')).toEqual([]);
    expect(resolvePersonCandidates(career, '@')).toEqual([]);
  });

  it('prefers whoever HOLDS the address now over whoever merely held it', () => {
    // One address, two humans, different decades — the case `Person.email @unique`
    // used to make impossible and #127 E9's unique-at-an-instant constraint will
    // police. Both are candidates, because it IS ambiguous; the ORDER is the
    // tie-break, so resolvePerson's guess is the incumbent and not array order.
    const successor = person(60, 'Ravi Patel', 'platform.lead@bosch.com');
    const predecessor = person(61, 'Ines Dupont', 'ines@qualcomm.com', 'platform.lead@bosch.com');
    expect(resolvePersonCandidates([predecessor, successor], 'platform.lead@bosch.com')
      .map((p) => p.id)).toEqual([60, 61]);
    expect(resolvePerson([predecessor, successor], 'platform.lead@bosch.com')?.id).toBe(60);
  });

  it('does not make a person a candidate twice when a period repeats their address', () => {
    const repeated = person(70, 'Sam Okafor', 'sam@google.com', 'sam@google.com');
    expect(resolvePersonCandidates([repeated], 'sam@google.com').map((p) => p.id)).toEqual([70]);
  });

  it('keeps a former address from outranking an exact CURRENT match at a lower tier', () => {
    // Tiering is unchanged: the exact-email tier matches Ines' old address and returns,
    // so Sam — who would match at the local-part tier — never joins the answer.
    const ines = person(80, 'Ines Dupont', 'ines@qualcomm.com', 'platform@bosch.com');
    const sam = person(81, 'Sam Okafor', 'platform@google.com');
    expect(resolvePersonCandidates([ines, sam], 'platform@bosch.com').map((p) => p.id))
      .toEqual([80]);
  });
});
