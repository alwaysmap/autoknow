import 'next-auth';
import 'next-auth/jwt';

// Surface the Google access token (and refresh metadata) on the session/JWT so the
// ingestion server action can read a Google Doc with the signed-in user's credentials.

declare module 'next-auth' {
  interface Session {
    accessToken?: string;
  }
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
