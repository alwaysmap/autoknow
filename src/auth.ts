import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';

// Auth.js v5 (NextAuth) configuration.
//
// Auth is ENFORCED only when AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET are set. With no
// credentials configured (CI, tests, fresh checkout) there are no providers, every
// session resolves to null, and middleware is a no-op — so the app keeps running on
// the stub identity (see lib/session.ts) and the E2E suite is unaffected.
//
// Sign-in is restricted to a Google Workspace domain via AUTH_ALLOWED_DOMAIN.
// The Drive read scope lets us fetch a pasted Google Doc's text with the user's token.

export const authConfigured =
  !!process.env.AUTH_GOOGLE_ID && !!process.env.AUTH_GOOGLE_SECRET;

const allowedDomain = process.env.AUTH_ALLOWED_DOMAIN;

const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/drive.readonly',
].join(' ');

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
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
      if (!allowedDomain) return true;
      // The Workspace hosted-domain (`hd`) claim is the reliable signal; fall back
      // to the email suffix.
      const hd = profile?.hd;
      const email = profile?.email ?? '';
      return hd === allowedDomain || email.endsWith(`@${allowedDomain}`);
    },
    async jwt({ token, account }) {
      // Persist the Google access token so server actions can call Drive on the
      // user's behalf. (Tokens are fresh right after sign-in; refresh is a TODO.)
      if (account) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.expiresAt = account.expires_at;
      }
      return token;
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken;
      return session;
    },
  },
});
