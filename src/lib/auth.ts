// Single source of truth for the current user's identity.
//
// The app previously hardcoded the literal `dylan` / `@dylan` / `dylan@google.com`
// in ~6 places (layout, /me, /partners, server actions, activity logs) and trusted
// a `?user=` query param verbatim. All of that should read identity through here so
// there is one seam to replace with a real session/auth lookup.

const DEFAULT_HANDLE = 'dylan';
const EMAIL_DOMAIN = 'google.com';
export interface CurrentUser {
  handle: string; // bare handle, e.g. 'dylan'
  display: string; // '@'-prefixed handle, e.g. '@dylan'
  email: string; // full email, e.g. 'dylan@google.com' — the WHOLE address, domain included
  name: string; // human name from the provider, e.g. 'Dylan Thomas'
  // Google's profile photo URL, or null. SERVER-SIDE ONLY: it is fetched by
  // /api/me/avatar and must never be handed to the browser, which would put a
  // googleusercontent.com request back on the page the proxy exists to avoid.
  image: string | null;
}

/** 'dylan' -> 'Dylan'; 'dylan.thomas' -> 'Dylan Thomas'. Used when the identity
 *  provider supplies no display name (stub identity, tests). */
function nameFromHandle(handle: string): string {
  const words = handle
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1));
  return words.join(' ') || handle;
}

/**
 * An address in its canonical stored form: trimmed and lower-cased. '' for nothing.
 *
 * ONE spelling, because an address is now stored in two places — `Person.email` and, per
 * employment period, `PersonAffiliation.email` (#127 E8) — and matched against BOTH by
 * `lib/people`'s resolver. Four call sites were doing `.trim().toLowerCase()` inline,
 * which is fine right up until one of them stops.
 *
 * THE ASYMMETRY IS GONE, and this records the answer because the question was recorded
 * here first: `PersonAffiliation.email` was canonicalized on write from the day it
 * existed (#127 E8) and `Person.email` was not — its schema took `z.email()` as typed,
 * and reads compensated, so nothing was wrong while equality was decided in JavaScript.
 * #127 E9 moved equality into Postgres, where `=` folds no case, so both columns are now
 * canonical on write (`lib/schemas`' `zEmail`) and E9's migration folded the rows that
 * predate it. Folding them was safe THERE and nowhere earlier: the same migration drops
 * the `@unique` index first, so the one way the rewrite could collide is gone before it
 * runs.
 */
export function normalizeAddress(input: string | null | undefined): string {
  return (input ?? '').trim().toLowerCase();
}

/** Strip a leading '@' and any domain, l-casing the result: '@Foo@bar.com' -> 'foo'. */
export function normalizeHandle(input: string | null | undefined): string {
  if (!input) return '';
  return input.trim().toLowerCase().replace(/^@/, '').split('@')[0];
}

/**
 * Derive a full email from a handle or email.
 * - 'jdoe@acme.com'  -> 'jdoe@acme.com' (already an email; preserved)
 * - '@jdoe' / 'jdoe' -> 'jdoe@google.com' (org default domain)
 */
export function deriveEmail(input: string | null | undefined): string {
  const raw = (input || '').trim().toLowerCase();
  if (raw.includes('@') && !raw.startsWith('@')) return raw;
  const handle = normalizeHandle(raw) || DEFAULT_HANDLE;
  return `${handle}@${EMAIL_DOMAIN}`;
}

/** Build a CurrentUser from any handle/email-ish string, plus what the identity
 *  provider itself told us — display name and profile photo — when it has them. */
export function userFromHandle(
  input: string | null | undefined,
  name?: string | null,
  image?: string | null,
): CurrentUser {
  const handle = normalizeHandle(input) || DEFAULT_HANDLE;
  return {
    handle,
    display: `@${handle}`,
    email: deriveEmail(input || handle),
    name: (name ?? '').trim() || nameFromHandle(handle),
    image: image || null,
  };
}

/**
 * Fallback identity used when authentication is not configured (CI, tests, fresh
 * checkout). The real signed-in user is resolved by getCurrentUser() in lib/session.ts,
 * which reads the Auth.js session and falls back here.
 */
export function stubUser(): CurrentUser {
  // No name and no photo: there is no identity provider behind the stub, so the
  // handle-derived name and the initials fallback are what dev/e2e should exercise.
  return userFromHandle(DEFAULT_HANDLE);
}
