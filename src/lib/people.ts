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
