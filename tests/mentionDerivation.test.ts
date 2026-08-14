// #177 — the confidence ladder made a value, and the floor that consumes it.
// `resolvePersonMatch` keeps which tier matched (and every candidate the tier
// produced); `deriveMentions` writes a person link ONLY when the winning tier holds
// exactly one candidate. Pure functions, no database.
import { resolvePersonMatch, resolvePersonCandidates, resolvePerson } from '../src/lib/people';
import { deriveMentions } from '../src/lib/mentions';

const P = (id: number, name: string, email: string, held: string[] = []) => ({
  id,
  name,
  email,
  affiliations: held.map((e) => ({ email: e as string | null })),
});

const directory = [
  P(1, 'Kenji Sato', 'kenji.sato@toyota.com'),
  P(2, 'Sarah Jenkins', 'sjenkins@qualcomm.com'),
  P(3, 'Marcus Webb', 'marcusw@google.com'),
  // The deliberate collision: two humans, one exact name (the seed carries the same
  // pair — the corpus's 'Jonas Weber' mentions must resolve to NOTHING).
  P(4, 'Jonas Weber', 'jonas.weber@bosch.com'),
  P(5, 'Jonas Weber', 'jweber@denso.example'),
  P(6, 'Alice Waters', 'alice@google.com', ['alice.waters@bosch.com']),
];

describe('resolvePersonMatch — the tier is kept, the candidates stay intact', () => {
  it('an exact current address matches at the email tier', () => {
    const match = resolvePersonMatch(directory, 'kenji.sato@toyota.com');
    expect(match?.basis).toBe('email');
    expect(match?.candidates.map((c) => c.id)).toEqual([1]);
  });

  it('an address HELD on a past period still matches at the email tier (#127 E8)', () => {
    const match = resolvePersonMatch(directory, 'alice.waters@bosch.com');
    expect(match?.basis).toBe('email');
    expect(match?.candidates.map((c) => c.id)).toEqual([6]);
  });

  it('a bare non-google handle falls through to the handle tier', () => {
    // deriveEmail('sjenkins') manufactures sjenkins@google.com, which matches nobody —
    // so the email tier passes and the local-part tier is what fires.
    const match = resolvePersonMatch(directory, 'sjenkins');
    expect(match?.basis).toBe('handle');
    expect(match?.candidates.map((c) => c.id)).toEqual([2]);
  });

  it('a bare handle at the org default domain resolves at the EMAIL tier', () => {
    // 'marcusw' derives marcusw@google.com, which IS the stored address — the default
    // domain makes google handles a stronger claim than other companies' handles.
    expect(resolvePersonMatch(directory, 'marcusw')?.basis).toBe('email');
  });

  it('an exact full name matches at the name tier, ambiguity intact', () => {
    const match = resolvePersonMatch(directory, 'Jonas Weber');
    expect(match?.basis).toBe('name');
    expect(match?.candidates.map((c) => c.id).sort()).toEqual([4, 5]);
  });

  it('no tier matching anything is null, and empty input is null', () => {
    expect(resolvePersonMatch(directory, 'Tomas Novak')).toBeNull();
    expect(resolvePersonMatch(directory, '')).toBeNull();
    expect(resolvePersonMatch(directory, null)).toBeNull();
  });

  it('the existing entry points are thin reads of the same match (acceptance 1)', () => {
    // Same tiers, same order, ambiguity dropped exactly as before — one matcher.
    expect(resolvePersonCandidates(directory, 'Jonas Weber').map((c) => c.id))
      .toEqual(resolvePersonMatch(directory, 'Jonas Weber')!.candidates.map((c) => c.id));
    expect(resolvePerson(directory, 'sjenkins')?.id).toBe(2);
    expect(resolvePersonCandidates(directory, 'nobody')).toEqual([]);
  });
});

describe('deriveMentions — the ownerBackfill floor, applied to model output', () => {
  it('links only unique winners; ambiguity and unknowns persist unresolved', () => {
    const mentions = deriveMentions(directory, [
      'kenji.sato@toyota.com', // email tier, unique -> linked
      'sjenkins',              // handle tier, unique -> linked
      'Marcus Webb',           // name tier, unique -> linked
      'Jonas Weber',           // name tier, TWO candidates -> the floor: no link
      'Tomas Novak',           // not in the directory -> kept, unresolved
    ]);
    expect(mentions).toEqual([
      { rawName: 'kenji.sato@toyota.com', personId: 1, basis: 'email' },
      { rawName: 'sjenkins', personId: 2, basis: 'handle' },
      { rawName: 'Marcus Webb', personId: 3, basis: 'name' },
      { rawName: 'Jonas Weber', personId: null, basis: null },
      { rawName: 'Tomas Novak', personId: null, basis: null },
    ]);
  });

  it('de-dupes case-insensitively keeping the first spelling, and drops blanks', () => {
    const mentions = deriveMentions(directory, ['Marcus Webb', 'MARCUS WEBB', '  ', '']);
    expect(mentions).toEqual([{ rawName: 'Marcus Webb', personId: 3, basis: 'name' }]);
  });

  it('bounds what one source can claim — a crafted document cannot write unbounded rows', () => {
    const flood = Array.from({ length: 80 }, (_, i) => `Invented Person ${i}`);
    expect(deriveMentions(directory, flood)).toHaveLength(50);
  });
});
