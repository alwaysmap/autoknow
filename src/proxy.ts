import { NextResponse } from 'next/server';
import { auth, authConfigured } from './auth';

// Route gate (Next 16 "proxy" convention, formerly "middleware"). When auth isn't
// configured (no Google credentials) this is a no-op so the app and the E2E suite run
// unauthenticated on the stub identity. When configured, unauthenticated requests are
// redirected to /login.
// Wrap with auth() ONLY when auth is enforced. The wrapper is pure overhead when
// unconfigured — and in Next 16.2.9 dev it leaves the server allocating promise-
// tracking garbage at ~10MB/s forever after the first request (heap-profiled
// 2026-07-17), which OOMs the dev server on small machines.
export default authConfigured
  ? auth((req) => {
      const { pathname } = req.nextUrl;
      const isPublic =
        pathname.startsWith('/api/auth') ||
        pathname === '/login' ||
        // The refresh worker is called by a scheduler, not a browser — it can never
        // hold a session. It carries its own CRON_SECRET auth (the route 401s
        // without the secret), so the session gate must let it through.
        pathname.startsWith('/api/cron') ||
        // Chat events arrive from Google's servers with their own JWT auth.
        pathname.startsWith('/api/chat');

      if (!req.auth && !isPublic) {
        return NextResponse.redirect(new URL('/login', req.nextUrl.origin));
      }
      return NextResponse.next();
    })
  : function proxy() {
      return NextResponse.next();
    };

export const config = {
  // Run on everything except static assets — and sw.js, which must stay reachable
  // unauthenticated: it serves the kill-switch that unregisters the retired offline
  // worker (see public/sw.js). Drop the exclusion when that file goes.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|sw.js|.*\\.(?:svg|png|ico)$).*)'],
};
