import 'next-auth';
import 'next-auth/jwt';

// Surface the Google access token (and refresh metadata) on the JWT so the ingestion
// server action can read a Google Doc with the signed-in user's credentials. The
// token deliberately does NOT ride on Session — the session object is served to the
// browser via /api/auth/session (see lib/session.getAccessToken for server reads).

declare module 'next-auth' {
  interface Profile {
    hd?: string;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
  }
}
