import { userFromHandle } from '../src/lib/auth';
import { initialsOf } from '../src/lib/people';

// How a person is SHOWN: the avatar initials, and the photo field behind them.
// The nav read 'DY'/'@dylan' because layout.tsx reached past getCurrentUser() for the
// name (ADR 0005) — that bypass is now a lint error; these pin the display rules.

describe('initialsOf', () => {
  it('takes the FIRST and LAST name initials', () => {
    expect(initialsOf('Dylan Thomas')).toBe('DT');
    expect(initialsOf('Junichi Monma')).toBe('JM');
  });

  it('skips middle names rather than displacing the family name', () => {
    expect(initialsOf('Dylan V. Thomas')).toBe('DT');
    expect(initialsOf('Maria de los Angeles Cruz')).toBe('MC');
  });

  it('keeps hyphenated names whole — only whitespace separates words', () => {
    expect(initialsOf('Mary Smith-Jones')).toBe('MS');
    expect(initialsOf('Anne-Marie Dubois')).toBe('AD');
  });

  it('falls back to the first two characters of a single-token name', () => {
    expect(initialsOf('Madonna')).toBe('MA');
    expect(initialsOf('本間淳一')).toBe('本間'); // unspaced CJK: the surname
  });

  it('tolerates handles, stray whitespace, and empty input', () => {
    expect(initialsOf('  Dylan   Thomas  ')).toBe('DT');
    expect(initialsOf('@dylan')).toBe('DY');
    expect(initialsOf('')).toBe('');
    expect(initialsOf('   ')).toBe('');
  });
});

describe('userFromHandle carries the profile photo', () => {
  // Name derivation itself is owned by tests/identity.test.ts — this covers only the
  // field added for the avatar proxy (ADR 0006).
  it('keeps the provider URL, and defaults to null rather than undefined', () => {
    const url = 'https://lh3.googleusercontent.com/a/ACg8ocK';
    expect(userFromHandle('dylan', 'Dylan Thomas', url).image).toBe(url);
    expect(userFromHandle('dylan').image).toBeNull();
  });

  it('feeds the initials rule from the provider name', () => {
    expect(initialsOf(userFromHandle('dylan@alwaysmap.com', 'Dylan Thomas').name)).toBe('DT');
  });
});
