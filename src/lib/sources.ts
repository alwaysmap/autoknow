// Source identity, mode inference, and fetch-safety for ingested context
// (docs/INGEST_FRESHNESS_PLAN.md §2, §4). Pure functions with no Node-only imports so
// both the ingest pipeline and the QuickIngest client chip can share them (hashing
// lives in lib/refresh, which is server-only).

export type SourceKind = 'drive' | 'chat' | 'tracker' | 'web' | 'text';
export type TrackingMode = 'snapshot' | 'watched';

export interface SourceInfo {
  kind: SourceKind;
  mode: TrackingMode; // inferred default; user-correctable via the chip
  /** Canonical identity for dedupe: Drive fileId, Chat thread, normalized URL. */
  sourceRef: string | null;
}

// Tracking params stripped during URL canonicalization — they change per visit
// without changing the page, which would break both dedupe and hash stability.
const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'gclid', 'fbclid', 'ref', 'usp', 'resourcekey',
]);

/** Normalize a URL into a stable canonical form (dedupe key + fetch target). */
export function canonicalizeUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  u.hash = '';
  u.hostname = u.hostname.toLowerCase();
  for (const key of [...u.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(key.toLowerCase())) u.searchParams.delete(key);
  }
  u.searchParams.sort();
  // Trailing slash on a bare path is not a different resource.
  if (u.pathname !== '/' && u.pathname.endsWith('/')) u.pathname = u.pathname.slice(0, -1);
  return u.toString();
}

const DRIVE_FILE_RE = /(?:docs|drive)\.google\.com\/(?:document|spreadsheets|presentation|file)\/d\/([a-zA-Z0-9_-]+)/;

/**
 * Infer what a pasted link IS and how it should be tracked (plan §2.1).
 * Deterministic by URL shape; the chip lets users flip the mode.
 */
export function inferSource(rawUrl: string | null): SourceInfo {
  if (!rawUrl || !rawUrl.trim()) {
    return { kind: 'text', mode: 'snapshot', sourceRef: null }; // pasted raw text: nothing to re-fetch
  }
  const canonical = canonicalizeUrl(rawUrl);
  if (!canonical) return { kind: 'text', mode: 'snapshot', sourceRef: null };
  const u = new URL(canonical);
  const host = u.hostname;

  const drive = rawUrl.match(DRIVE_FILE_RE);
  if (drive) return { kind: 'drive', mode: 'watched', sourceRef: `drive:${drive[1]}` };

  if (host === 'chat.google.com' || host === 'mail.google.com') {
    // A sent message is an event — snapshot; the thread is the identity (re-shares
    // of the same thread become revisions, not duplicates).
    return { kind: 'chat', mode: 'snapshot', sourceRef: canonical };
  }

  const isTracker =
    /(^|\.)github\.com$/.test(host) && /\/(issues|pull)\/\d+/.test(u.pathname) ||
    /-review\.googlesource\.com$/.test(host) ||
    /(^|\.)b\.corp\.google\.com$/.test(host) ||
    host === 'issuetracker.google.com' ||
    /(^|\.)atlassian\.net$/.test(host) && /\/browse\//.test(u.pathname);
  if (isTracker) return { kind: 'tracker', mode: 'watched', sourceRef: canonical };

  return { kind: 'web', mode: 'watched', sourceRef: canonical };
}

/** Normalize fetched text so cosmetic noise doesn't read as change (plan §4 Gate 2). */
export function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---- Fetch safety (plan §4) ---------------------------------------------------------

/** Hostnames/IPs the server must never fetch: SSRF guard for user-pasted URLs. */
export function isForbiddenHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, ''); // strip IPv6 brackets
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h === '::1' || h === '::' || h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [parseInt(m[1], 10), parseInt(m[2], 10)];
  if (a === 127 || a === 10 || a === 0) return true; // loopback, RFC-1918, "this net"
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC-1918
  if (a === 192 && b === 168) return true; // RFC-1918
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  return false;
}

/**
 * Does a fetched page look like an auth wall rather than content? Hashing or
 * digesting a login page would record a bogus "change" and poison the digest
 * (plan §4) — callers freeze the row as `auth-required` instead.
 */
export function looksLikeAuthWall(finalUrl: string, text: string): boolean {
  try {
    const host = new URL(finalUrl).hostname;
    if (host === 'accounts.google.com' || host.startsWith('login.') || host.startsWith('sso.') || host.startsWith('auth.')) {
      return true;
    }
  } catch {
    /* not a URL — judge by content */
  }
  const head = text.slice(0, 4000).toLowerCase();
  const signals = ['sign in', 'log in to continue', 'single sign-on', 'authentication required', 'password', 'type="password"'];
  const hits = signals.filter((s) => head.includes(s)).length;
  // Short page + multiple sign-in signals = a wall, not an article that mentions login.
  return hits >= 2 && normalizeText(text).length < 3000;
}

/** Strip HTML to indexable text (crude but sufficient for digesting web pages). */
export function htmlToText(html: string): string {
  return normalizeText(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<\/(p|div|li|h[1-6]|tr|br)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&quot;/g, '"'),
  );
}
