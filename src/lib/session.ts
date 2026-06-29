import 'server-only';
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

/** The signed-in user's Google access token (for Drive/Docs calls), or null. */
export async function getAccessToken(): Promise<string | null> {
  try {
    const session = await auth();
    return session?.accessToken ?? null;
  } catch {
    return null;
  }
}
