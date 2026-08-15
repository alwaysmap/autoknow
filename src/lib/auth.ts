// Single source of truth for the current user's identity.
//
// The app previously hardcoded the literal `dylan` / `@dylan` / `dylan@google.com`
// in ~6 places (layout, /me, /partners, server actions, activity logs) and trusted
// a `?user=` query param verbatim. All of that should read identity through here so
// there is one seam to replace with a real session/auth lookup.

const DEFAULT_HANDLE = 'dylan';

/** What a bare `@handle` means when NOTHING has told us the tenant — an unconfigured
 *  checkout, CI, the e2e stub identity. A deployment states its domain in
 *  `AUTH_ALLOWED_DOMAIN`; this is the dev fallback, not the answer. */
export const DEFAULT_EMAIL_DOMAIN = 'google.com';

/**
 * The org's own domain — what a bare `@handle` expands to.
 *
 * Reads `AUTH_ALLOWED_DOMAIN`, the single source of truth for "who may sign in", because
 * a deployment whose sign-in gate says `alwaysmap.com` and whose handle expansion says
 * `google.com` is manufacturing addresses for a tenant it does not serve (gh-255). It
 * used to be a second constant, and the divergence had already caused a real bug —
 * `/me?user=` re-derived the signed-in user's address at `@google.com` and landed on a
 * different person, worked around locally in `app/me/page.tsx` rather than fixed here.
 *
 * SERVER-SIDE READ. Only `NEXT_PUBLIC_*` is inlined into the browser bundle, so a
 * `'use client'` component calling this gets the FALLBACK silently and forever
 * (docs/knowledge/an-env-derived-default-is-the-fallback-inside-a-client-component.md).
 * That is why `deriveEmail`'s domain is a real parameter: a client caller is handed the
 * value as a required prop, resolved by the server component that renders it.
 */
export function orgEmailDomain(): string {
  return process.env.AUTH_ALLOWED_DOMAIN?.trim() || DEFAULT_EMAIL_DOMAIN;
}

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
 * BOTH columns are canonical ON WRITE (`lib/schemas`' `zEmail`), and E9's migration
 * folded the rows that predate that. It has to be both, because #127 E9 moved equality
 * into Postgres — where `=` folds no case — and the argument is in ADR
 * an-address-is-unique-at-an-instant-not-forever.
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
 * - '@jdoe' / 'jdoe' -> 'jdoe@<org domain>'
 *
 * `domain` defaults to `orgEmailDomain()`, which is a SERVER read — see its comment. A
 * client component must pass the domain explicitly rather than take the default, or it
 * silently expands every handle at the fallback domain.
 */
export function deriveEmail(
  input: string | null | undefined,
  domain: string = orgEmailDomain(),
): string {
  const raw = (input || '').trim().toLowerCase();
  if (raw.includes('@') && !raw.startsWith('@')) return raw;
  const handle = normalizeHandle(raw) || DEFAULT_HANDLE;
  return `${handle}@${domain}`;
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
