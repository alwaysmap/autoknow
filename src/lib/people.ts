import { deriveEmail, normalizeHandle } from './auth';

// Shared person-resolution used by Programs, Partners, Project detail, and Me.
// Previously this logic was copy-pasted in 4+ files, and each copy's email branch
// was dead (it compared a full email against an already-stripped handle), so every
// lookup fell through to a `name.includes(handle)` substring match — which linked
// handles like 'jo' to unrelated people such as 'Joanne'. Resolve on the unique
// email instead, with exact (non-substring) fallbacks only.

export interface PersonLike {
  id: number;
  name: string;
  email: string;
}

/**
 * Avatar initials: FIRST name initial + LAST name initial — 'Dylan Thomas' -> 'DT',
 * 'Junichi Monma' -> 'JM', 'Anne-Marie Dubois' -> 'AD'. Taking the LAST word (not the
 * second) keeps the family name when a middle name is present, and splitting on
 * whitespace only keeps hyphenated surnames intact ('Mary Smith-Jones' -> 'MS').
 *
 * A single-token name — a mononym, or an unspaced CJK name like '本間淳一' — keeps its
 * first two characters. That is a deliberately simple rule rather than a guess at
 * every script's name order; when a name has spaces, first+last is the safe reading.
 */
export function initialsOf(name: string): string {
  const words = (name || '').trim().replace(/^@/, '').split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  // Array.from, not [0]/slice: those index UTF-16 units and would halve an emoji or
  // an astral-plane character into a replacement glyph.
  const chars = (w: string) => Array.from(w);
  if (words.length === 1) return chars(words[0]).slice(0, 2).join('').toUpperCase();
  return (chars(words[0])[0] + chars(words[words.length - 1])[0]).toUpperCase();
}

/**
 * Resolve a handle or email ('@jdoe', 'jdoe', 'jdoe@google.com') to a Person, or
 * null when there is no confident match. Order: exact email, then email local-part,
 * then exact (case-insensitive) full name. No substring matching by design.
 */
export function resolvePerson<T extends PersonLike>(
  people: T[],
  handleOrEmail: string | null | undefined,
): T | null {
  if (!handleOrEmail) return null;
  const email = deriveEmail(handleOrEmail);
  const handle = normalizeHandle(handleOrEmail);
  if (!handle) return null;

  const byEmail = people.find((p) => p.email?.toLowerCase() === email);
  if (byEmail) return byEmail;

  const byLocalPart = people.find((p) => p.email?.toLowerCase().split('@')[0] === handle);
  if (byLocalPart) return byLocalPart;

  const byName = people.find((p) => p.name?.toLowerCase() === handle);
  return byName || null;
}
