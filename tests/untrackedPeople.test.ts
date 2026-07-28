// #126 / #127 E15. The detector behind the "track person" affordance: which mentions in
// prose name a human nobody has tracked. Pure — no database, no env — which is the whole
// reason it is a separate module from the surfaces that render it, and why the cases
// below can be exhaustive about the edges instead of sampling them.
//
// The two safety rules it inherits from `linkify`, both erring toward NO affordance over
// a wrong one, are what most of this file is about: a false offer creates a duplicate
// human at ingestion scale, which is `copyPerson`'s damage with a friendly button.
import { annotateUntracked, inferPartnerFromAddress, type Segment } from '../src/lib/untrackedPeople';

const ctx = (over: Partial<Parameters<typeof annotateUntracked>[1]> = {}) => ({
  tracked: new Set<string>(),
  dismissed: new Set<string>(),
  defaultDomain: 'google.com',
  ...over,
});

/** The addresses a pass claimed, in order — what every assertion here is really about. */
const claims = (segments: Segment[]) =>
  segments.filter((s) => s.untracked).map((s) => s.untracked);

/** The text, reassembled. A pass that loses or duplicates a character is a pass that
 *  corrupts the prose it annotates, and no assertion about claims would catch it. */
const rejoined = (segments: Segment[]) => segments.map((s) => s.text).join('');

describe('what it claims', () => {
  it('finds a bare address and leaves the prose around it intact', () => {
    const text = 'Ask dieter@bosch.example about the thermal budget.';
    const out = annotateUntracked(text, ctx());
    expect(claims(out)).toEqual(['dieter@bosch.example']);
    expect(rejoined(out)).toBe(text);
  });

  it('finds an @handle and reads it as an org address', () => {
    const out = annotateUntracked('ping @dmeyer on the rebase', ctx());
    expect(claims(out)).toEqual(['dmeyer@google.com']);
    // The claimed TEXT is the handle as written, not the address it resolves to — the
    // affordance decorates what the author typed.
    expect(out.find((s) => s.untracked)?.text).toBe('@dmeyer');
  });

  it('canonicalizes, so a capitalized mention is the same person as a lowercase one', () => {
    expect(claims(annotateUntracked('Dieter@Bosch.Example wrote', ctx()))).toEqual([
      'dieter@bosch.example',
    ]);
  });

  it('claims only the FIRST mention of an address — 40 mentions is one affordance', () => {
    const out = annotateUntracked(
      'dieter@bosch.example said. Later dieter@bosch.example agreed. And DIETER@bosch.example again.',
      ctx(),
    );
    expect(claims(out)).toEqual(['dieter@bosch.example']);
  });

  it('claims each DIFFERENT address once, in the order they appear', () => {
    const out = annotateUntracked('lena@conti.example and @dmeyer and aiko@honda.example', ctx());
    expect(claims(out)).toEqual(['lena@conti.example', 'dmeyer@google.com', 'aiko@honda.example']);
  });
});

describe('what it refuses to claim', () => {
  // #126 decision 1, and the reason the detector is addresses-and-handles only. This
  // domain is full of capitalised multi-word nouns a bare-name matcher cannot tell from
  // a person, and an affordance people learn to ignore is worse than none.
  it('produces ZERO annotations for the domain nouns that look like names', () => {
    const text =
      'Ford Explorer and Digital Key slipped; Rich Media is blocked on Launch Readiness, '
      + 'and Vehicle Sensors & VHAL needs Compliance Gates. Dieter Meyer is not matched either.';
    const out = annotateUntracked(text, ctx());
    expect(claims(out)).toEqual([]);
    expect(out).toEqual([{ text }]);
  });

  it('does not offer to create someone we already have', () => {
    const out = annotateUntracked('dieter@bosch.example wrote', ctx({
      tracked: new Set(['dieter@bosch.example']),
    }));
    expect(claims(out)).toEqual([]);
  });

  // THE SAFETY CASE. A mention of an address a tracked person has LEFT must not offer to
  // create a second copy of them — that is the #124 Class 4 hazard #126 blocked itself on
  // until E8 landed. The caller supplies historical addresses in `tracked`; this asserts
  // the detector honours them exactly like current ones.
  it('does not offer to create a tracked person mentioned by an address they LEFT', () => {
    const out = annotateUntracked('per alice.waters@bosch.com in the 2022 review', ctx({
      tracked: new Set(['alice@google.com', 'alice.waters@bosch.com', 'awaters@qualcomm.com']),
    }));
    expect(claims(out)).toEqual([]);
  });

  it('does not offer an address a human dismissed as not-a-person', () => {
    const out = annotateUntracked('filed to android-team@google.com for triage', ctx({
      dismissed: new Set(['android-team@google.com']),
    }));
    expect(claims(out)).toEqual([]);
  });

  it('leaves a run another pass already claimed as a link alone', () => {
    // `linkify` ran first and wrapped a known entity. Offering to "track" a person the
    // prose already links to is the contradiction this check exists to prevent.
    const existing: Segment[] = [
      { text: 'see ' },
      { text: 'Honda Accord', href: '/programs/4' },
      { text: ' — ask dieter@bosch.example' },
    ];
    const out = annotateUntracked('', ctx(), existing);
    expect(claims(out)).toEqual(['dieter@bosch.example']);
    expect(out.find((s) => s.href)?.text).toBe('Honda Accord');
  });
});

describe('where it draws the edges of a mention', () => {
  // Each of these is a character the address pattern must NOT swallow, because the
  // affordance renders the claimed text and a trailing '.' or ')' reads as a typo the
  // app introduced.
  it.each([
    ['a sentence period', 'Ask dieter@bosch.example.', 'dieter@bosch.example'],
    ['a parenthetical', '(dieter@bosch.example)', 'dieter@bosch.example'],
    ['a comma', 'dieter@bosch.example, and then', 'dieter@bosch.example'],
    ['a markdown link', '[Dieter](mailto:dieter@bosch.example)', 'dieter@bosch.example'],
  ])('stops at %s', (_label, text, expected) => {
    const out = annotateUntracked(text, ctx());
    expect(out.find((s) => s.untracked)?.text).toBe(expected);
    expect(rejoined(out)).toBe(text);
  });

  it('does not read the domain of an address as a bare handle', () => {
    // The handle pattern must not re-match inside an address it already claimed;
    // otherwise every address yields a phantom second person named after its domain.
    const out = annotateUntracked('dieter@bosch.example', ctx());
    expect(claims(out)).toEqual(['dieter@bosch.example']);
  });

  it('ignores a one-character handle — an initial is not a person', () => {
    expect(claims(annotateUntracked('cc @d on this', ctx()))).toEqual([]);
  });

  it('returns the text as ONE plain segment when nothing matches, like linkify', () => {
    expect(annotateUntracked('nothing here', ctx())).toEqual([{ text: 'nothing here' }]);
  });

  it('returns nothing for empty text', () => {
    expect(annotateUntracked('', ctx())).toEqual([]);
  });
});

describe('inferring the company from the address domain', () => {
  const partners = [
    { id: 1, name: 'Bosch' },
    { id: 2, name: 'Volvo Cars' },
    { id: 3, name: 'LG Electronics' },
  ];

  it('matches a domain label to a partner, folding case and spacing', () => {
    expect(inferPartnerFromAddress('dieter@bosch.example', partners)).toBe(1);
    expect(inferPartnerFromAddress('sven@volvocars.example', partners)).toBe(2);
  });

  it('answers null rather than guessing when nothing folds to the label', () => {
    expect(inferPartnerFromAddress('someone@unknownco.example', partners)).toBeNull();
  });

  it('answers null when two partners fold to one label — better none than the wrong one', () => {
    const ambiguous = [...partners, { id: 4, name: 'B.O.S.C.H.' }];
    expect(inferPartnerFromAddress('dieter@bosch.example', ambiguous)).toBeNull();
  });

  it('answers null for a malformed address rather than throwing', () => {
    expect(inferPartnerFromAddress('not-an-address', partners)).toBeNull();
    expect(inferPartnerFromAddress('', partners)).toBeNull();
  });
});
