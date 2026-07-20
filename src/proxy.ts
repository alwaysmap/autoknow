import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { auth, authConfigured } from './auth';

// Route gate (Next 16 "proxy" convention, formerly "middleware"). When auth isn't
// configured (no Google credentials) this is a no-op so the app and the E2E suite run
// unauthenticated on the stub identity. When configured, unauthenticated requests are
// redirected to /login.
// Wrap with auth() ONLY when auth is enforced. The wrapper is pure overhead when
// unconfigured — and in Next 16.2.9 dev it leaves the server allocating promise-
// tracking garbage at ~10MB/s forever after the first request (heap-profiled
// 2026-07-17), which OOMs the dev server on small machines.

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Fixed-window per-IP rate limiter. In-memory is correct here: single-instance
// deployment, and the proxy is defense-in-depth (the expensive routes also carry
// their own auth). Applied only when auth is configured, so dev/e2e seeding is
// never throttled.
const WINDOW_MS = 60_000;
const buckets = new Map<string, { start: number; count: number }>();
function rateLimited(key: string, limit: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now - b.start >= WINDOW_MS) {
    if (buckets.size > 10_000) buckets.clear(); // unbounded-growth guard
    buckets.set(key, { start: now, count: 1 });
    return false;
  }
  b.count += 1;
  return b.count > limit;
}

function limitFor(pathname: string, method: string): number | null {
  if (!pathname.startsWith('/api')) return null;
  // Gemini-invoking regeneration is the cost-amplification target.
  if (pathname.startsWith('/api/summaries') && method === 'POST') return 10;
  if (pathname.startsWith('/api/auth')) return 30;
  if (pathname.startsWith('/api/chat')) return 60;
  return MUTATING.has(method) ? 120 : 300;
}

/** Checks that apply regardless of auth configuration. Returns a response to
 *  short-circuit with, or null to continue. */
function baseGate(req: NextRequest): NextResponse | null {
  // CSRF belt-and-suspenders on top of SameSite=Lax: browsers label genuinely
  // cross-site subresource/form requests; non-browser callers (cron, relay, curl)
  // don't send the header and are unaffected.
  if (MUTATING.has(req.method) && req.headers.get('sec-fetch-site') === 'cross-site') {
    return NextResponse.json({ error: 'Cross-site requests are not accepted' }, { status: 403 });
  }
  return null;
}

export default authConfigured
  ? auth((req) => {
      const { pathname } = req.nextUrl;
      if (process.env.DEBUG_REQUESTS) console.log(`[req] ${req.method} ${pathname}`);

      const blocked = baseGate(req);
      if (blocked) return blocked;

      const limit = limitFor(pathname, req.method);
      if (limit != null) {
        const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
        // Bucket by IP + path class so one chatty client can't starve another.
        const cls = pathname.split('/').slice(0, 3).join('/');
        if (rateLimited(`${ip}:${cls}`, limit)) {
          return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
        }
      }

      // Admin requests: the proxy validates the token VALUE itself, so a future
      // /api/admin/* route that forgets its own check is still not internet-exposed.
      // (Routes still re-validate with a timing-safe compare — this gate is coarse.)
      if (pathname.startsWith('/api/admin') && req.headers.get('x-admin-token') !== null) {
        const token = process.env.ADMIN_TOKEN;
        if (!token || req.headers.get('x-admin-token') !== token) {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
        return NextResponse.next();
      }

      const isPublic =
        pathname.startsWith('/api/auth') ||
        pathname === '/login' ||
        // The refresh worker is called by a scheduler, not a browser — it can never
        // hold a session. It carries its own CRON_SECRET auth (the route 401s
        // without the secret), so the session gate must let it through.
        pathname.startsWith('/api/cron') ||
        // Chat events arrive from Google's servers with their own JWT auth.
        pathname.startsWith('/api/chat') ||
        // Liveness probe for uptime checks and deploy smoke tests — no session,
        // no secrets in the response (see the route).
        pathname === '/api/health';

      if (!req.auth && !isPublic) {
        return NextResponse.redirect(new URL('/login', req.nextUrl.origin));
      }
      return NextResponse.next();
    })
  : function proxy(req: NextRequest) {
      return baseGate(req) ?? NextResponse.next();
    };

export const config = {
  // Run on everything except static assets — and sw.js, which must stay reachable
  // unauthenticated: it serves the kill-switch that unregisters the retired offline
  // worker (see public/sw.js). Drop the exclusion when that file goes.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|sw.js|.*\\.(?:svg|png|ico)$).*)'],
};
