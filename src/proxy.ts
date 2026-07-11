import { NextResponse } from 'next/server';
import { auth, authConfigured } from './auth';

// Route gate (Next 16 "proxy" convention, formerly "middleware"). When auth isn't
// configured (no Google credentials) this is a no-op so the app and the E2E suite run
// unauthenticated on the stub identity. When configured, unauthenticated requests are
// redirected to /login.
export default auth((req) => {
  if (!authConfigured) return NextResponse.next();

  const { pathname } = req.nextUrl;
  const isPublic = pathname.startsWith('/api/auth') || pathname === '/login';

  if (!req.auth && !isPublic) {
    return NextResponse.redirect(new URL('/login', req.nextUrl.origin));
  }
  return NextResponse.next();
});

export const config = {
  // Run on everything except static assets — and sw.js, which must stay reachable
  // unauthenticated: it serves the kill-switch that unregisters the retired offline
  // worker (see public/sw.js). Drop the exclusion when that file goes.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|sw.js|.*\\.(?:svg|png|ico)$).*)'],
};
