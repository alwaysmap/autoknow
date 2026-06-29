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
  email: string; // full email, e.g. 'dylan@google.com'
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

/** Build a CurrentUser from any handle/email-ish string. */
export function userFromHandle(input: string | null | undefined): CurrentUser {
  const handle = normalizeHandle(input) || DEFAULT_HANDLE;
  return { handle, display: `@${handle}`, email: deriveEmail(input || handle) };
}

/**
 * Fallback identity used when authentication is not configured (CI, tests, fresh
 * checkout). The real signed-in user is resolved by getCurrentUser() in lib/session.ts,
 * which reads the Auth.js session and falls back here.
 */
export function stubUser(): CurrentUser {
  return userFromHandle(DEFAULT_HANDLE);
}
