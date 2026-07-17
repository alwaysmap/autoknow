import 'server-only';
import { createSign } from 'crypto';
import { readFileSync } from 'fs';

// Service-account auth for background Drive access (plan §5): key-based JWT grant,
// no session, no consent flow. The key comes from GOOGLE_SERVICE_ACCOUNT_JSON
// (inline) or GOOGLE_APPLICATION_CREDENTIALS (path). Absent key ⇒ driveConfigured
// is false and everything degrades honestly (worker skips Drive, Sources page says
// how to turn it on).

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

function loadKey(): ServiceAccountKey | null {
  try {
    const inline = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (inline && inline.trim()) return JSON.parse(inline) as ServiceAccountKey;
    const path = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (path && path.trim()) return JSON.parse(readFileSync(path, 'utf8')) as ServiceAccountKey;
  } catch (e) {
    console.error('Service-account key unreadable:', (e as Error).message);
  }
  return null;
}

const key = loadKey();

export const driveConfigured = !!key?.client_email && !!key?.private_key;

/** The address users share files/folders with. */
export function serviceAccountEmail(): string | null {
  return key?.client_email ?? null;
}

const b64url = (input: string | Buffer): string =>
  Buffer.from(input).toString('base64url');

let cached: { token: string; expiresAt: number } | null = null;

/** Mint (and cache) an access token via the signed-JWT grant. */
export async function getServiceAccountToken(): Promise<string> {
  if (!key) throw new Error('No service-account key configured.');
  if (cached && Date.now() < cached.expiresAt - 60_000) return cached.token;

  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(
    JSON.stringify({
      iss: key.client_email,
      scope: DRIVE_SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  );
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const signature = signer.sign(key.private_key).toString('base64url');
  const assertion = `${header}.${claims}.${signature}`;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Service-account token grant failed (${res.status}). ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cached.token;
}
