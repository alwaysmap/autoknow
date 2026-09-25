import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import { signInDomains, mayUseDomain } from './lib/signInGate';

// Auth.js v5 (NextAuth) configuration.
//
// Auth is ENFORCED only when AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET are set. With no
// credentials configured (CI, tests, fresh checkout) there are no providers, every
// session resolves to null, and middleware is a no-op — so the app keeps running on
// the stub identity (see lib/session.ts) and the E2E suite is unaffected.
//
// Sign-in is restricted to the tenant Workspace domain (AUTH_ALLOWED_DOMAIN), widened by
// AUTH_ADDITIONAL_SIGNIN_DOMAINS — the rule lives in lib/signInGate.
// The Drive read scope lets us fetch a pasted Google Doc's text with the user's token.

export const authConfigured =
  !!process.env.AUTH_GOOGLE_ID && !!process.env.AUTH_GOOGLE_SECRET;

const allowedDomains = signInDomains();

const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/drive.readonly',
].join(' ');

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  // Pin the session cookie explicitly (these ARE the v5 defaults, but CSRF
  // resistance rests on them — they must not drift silently with an upgrade).
  cookies: {
    sessionToken: {
      options: {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
      },
    },
  },
  providers: authConfigured
    ? [
        Google({
          authorization: {
            params: {
              scope: GOOGLE_SCOPES,
              access_type: 'offline',
              // select_account: always show the account picker — with several Google
              // sessions in the browser, Google otherwise auto-picks the active one
              // (often a personal gmail) and the domain check then rejects it.
              prompt: 'select_account consent',
            },
          },
        }),
      ]
    : [],
  callbacks: {
    async signIn({ profile }) {
      return mayUseDomain(profile, allowedDomains);
    },
    async jwt({ token, account }) {
      // Persist the Google access token so server actions can call Drive on the
      // user's behalf. (Tokens are fresh right after sign-in; refresh is a TODO.)
      // The token lives ONLY in the encrypted JWT cookie: it must never be copied
      // onto the session object, which Auth.js serves verbatim to the browser via
      // /api/auth/session — that exposed a drive.readonly bearer token to any
      // script with DOM access. Server code reads it via lib/session.getAccessToken.
      if (account) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.expiresAt = account.expires_at;
      }
      return token;
    },
  },
});
