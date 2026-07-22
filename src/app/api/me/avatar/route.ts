import { getCurrentUser } from '../../../../lib/session';
import { allowedAvatarUrl } from '../../../../lib/avatar';

// Serves the SIGNED-IN user's Google profile photo from our own origin, so the CSP
// keeps `img-src 'self'` (next.config.ts) and no page makes a googleusercontent.com
// request. Session-gated by src/proxy.ts like any other browser route — it is NOT in
// that file's `isPublic` list, and must not be: the response is one person's photo.
//
// Every failure path returns 404, and UserMenu falls back to initials. A missing
// photo is the normal case (stub identity, Workspace accounts without one), not an
// error worth a 5xx or a broken image icon.

export const dynamic = 'force-dynamic';

const TIMEOUT_MS = 5_000;
const MAX_BYTES = 512 * 1024; // a 2.75rem avatar; anything larger is not a photo

const notFound = () =>
  new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } });

export async function GET() {
  const user = await getCurrentUser();
  const url = allowedAvatarUrl(user.image);
  if (!url) return notFound();

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // A redirect is the one way a request that started inside the allowlist can
      // finish outside it, which is the SSRF hole this route would otherwise open.
      // Google serves these directly; if that ever changes, re-validate each hop
      // rather than switching to 'follow'.
      redirect: 'error',
    });
  } catch {
    return notFound();
  }

  const type = upstream.headers.get('content-type') || '';
  if (!upstream.ok || !type.startsWith('image/')) return notFound();

  const body = await upstream.arrayBuffer();
  if (body.byteLength > MAX_BYTES) return notFound();

  return new Response(body, {
    headers: {
      'content-type': type,
      'content-length': String(body.byteLength),
      // PRIVATE: the path is the same for every user, so a shared cache keyed on it
      // would hand one person's face to the next. Browser-only, and short enough
      // that a changed photo appears within the hour.
      'cache-control': 'private, max-age=3600',
      'content-security-policy': "default-src 'none'; sandbox",
      'x-content-type-options': 'nosniff',
    },
  });
}
