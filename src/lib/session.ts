import 'server-only';
import { cookies } from 'next/headers';
import { getToken } from 'next-auth/jwt';
import { auth } from '../auth';
import { stubUser, userFromHandle, type CurrentUser } from './auth';

// Server-only bridge between Auth.js and the app's CurrentUser. Kept separate from
// lib/auth.ts (which stays pure) so client components importing the handle helpers
// never pull in next-auth.

export async function getCurrentUser(): Promise<CurrentUser> {
  try {
    const session = await auth();
    const email = session?.user?.email;
    if (email) return userFromHandle(email);
  } catch {
    // Auth not configured or unavailable — fall back to the stub identity.
  }
  return stubUser();
}

/**
 * The signed-in user's Google access token (for Drive/Docs calls), or null.
 * Read from the encrypted JWT cookie directly — the token is deliberately NOT on
 * the session object, which Auth.js serves verbatim to the browser.
 */
export async function getAccessToken(): Promise<string | null> {
  try {
    const store = await cookies();
    // Auth.js prefixes the cookie with __Secure- when running on https.
    for (const name of ['__Secure-authjs.session-token', 'authjs.session-token']) {
      const raw = store.get(name)?.value;
      if (!raw) continue;
      const token = await getToken({
        req: { headers: new Headers({ cookie: `${name}=${raw}` }) },
        secret: process.env.AUTH_SECRET ?? '',
        salt: name,
        cookieName: name,
      });
      const accessToken = (token as { accessToken?: string } | null)?.accessToken;
      if (accessToken) return accessToken;
    }
    return null;
  } catch {
    return null;
  }
}
