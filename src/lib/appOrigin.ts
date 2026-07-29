// THE app's own public origin, derived from the request being served.
//
// It exists because two very different callers need to write an ABSOLUTE in-app URL into a
// Google Chat message — the inbound webhook reply (`api/chat/events`) and the outbound
// post-back a server action sends (`app/actions/escalations`) — and a Chat message is read
// outside the app, where a relative path resolves against chat.google.com and goes nowhere.
//
// One definition rather than two, because the two it replaces had already drifted: the
// route did `https://${host}` while the action read the forwarded headers, so behind the
// proxy they could disagree about the host and on localhost one of them produced an
// `https://localhost:3000` that no browser would open. A comment claiming they were "the
// same derivation" is what made that invisible.
//
// Client-safe and dependency-free: it takes anything with `get(name)`, which is both
// `Request.headers` and what `next/headers` returns.

interface HeaderBag {
  get(name: string): string | null;
}

/** `https://autoknow.alwaysmap.com`, or null when the host cannot be read — in which case
 *  a caller must omit its link rather than emit a broken one. */
export function originFromHeaders(headers: HeaderBag): string | null {
  // Cloud Run terminates TLS and forwards, so the forwarded pair is the truth where it is
  // present; `host` is the direct-connection fallback.
  const host = headers.get('x-forwarded-host') ?? headers.get('host');
  if (!host) return null;
  const proto =
    headers.get('x-forwarded-proto') ??
    (/^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(host) ? 'http' : 'https');
  return `${proto}://${host}`;
}

/** An absolute URL for an in-app path, or null when there is no origin to hang it off.
 *  Trailing slashes are stripped so `origin + href` cannot produce a double slash. */
export function absoluteUrl(origin: string | null | undefined, href: string): string | null {
  if (!origin) return null;
  return `${origin.replace(/\/+$/, '')}${href}`;
}
