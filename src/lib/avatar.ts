// The signed-in user's Google profile photo, and the one rule that makes serving it
// safe.
//
// The photo is proxied through /api/me/avatar rather than linked directly, so the
// app's CSP keeps `img-src 'self'` (next.config.ts) and the browser never talks to
// googleusercontent.com. That trade moves the risk server-side: the app now fetches
// a URL that arrived over the wire, which is an SSRF primitive unless the host is
// pinned. Hence this allowlist — it is the whole security boundary of that route,
// which is why it lives in its own tested module rather than inline in the handler.

/** Where Google serves profile photos. Workspace avatars come from lh3–lh6. */
function isGoogleUserContent(host: string): boolean {
  // The leading dot matters: a bare `endsWith('googleusercontent.com')` would also
  // accept `evilgoogleusercontent.com`.
  return host === 'googleusercontent.com' || host.endsWith('.googleusercontent.com');
}

/**
 * An account with no photo still gets a `picture` claim — Google's generic blue
 * silhouette at `/a/default-user`. Serving it would REPLACE 'DT' with a graphic that
 * says nothing about who is signed in, in a blue this palette reserves for links
 * (design.md §6, §8b). Initials win, so treat the placeholder as no photo at all.
 */
function isGooglePlaceholder(pathname: string): boolean {
  return pathname.includes('default-user');
}

/**
 * The URL to fetch a profile photo from, or null if it is anything we won't touch.
 * Null is not an error — most callers simply fall back to initials.
 */
export function allowedAvatarUrl(input: string | null | undefined): URL | null {
  if (!input) return null;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  // https only: a plaintext hop would let the network substitute the bytes, and
  // every legitimate Google picture claim is https.
  if (url.protocol !== 'https:') return null;
  if (!isGoogleUserContent(url.hostname.toLowerCase())) return null;
  if (isGooglePlaceholder(url.pathname)) return null;
  return url;
}
