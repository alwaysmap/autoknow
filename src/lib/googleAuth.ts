import 'server-only';
import { createSign } from 'crypto';
import { readFileSync } from 'fs';

// Service-account auth for background Drive access (plan §5) and the Google Chat bot.
// Two modes, preferred first:
//
//  1. Keyless (Workload Identity) — on Cloud Run the app runs AS a service account. We
//     take that SA's ambient token from the metadata server and exchange it via the IAM
//     Credentials API for a token scoped to Drive / chat.bot. No key material anywhere.
//     Needs GOOGLE_SA_EMAIL (the runtime SA) and that SA holding
//     roles/iam.serviceAccountTokenCreator on itself.
//  2. Key file — a service-account key in GOOGLE_SERVICE_ACCOUNT_JSON (inline) or
//     GOOGLE_APPLICATION_CREDENTIALS (path), used via a signed-JWT grant. For local/dev
//     or non-GCP hosts.
//
// With neither, driveConfigured is false and everything degrades honestly (worker skips
// Drive, Sources page says how to turn it on, Chat endpoint returns 503).

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
export const CHAT_BOT_SCOPE = 'https://www.googleapis.com/auth/chat.bot';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const METADATA_TOKEN_URL =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';

function loadKey(): ServiceAccountKey | null {
  try {
    const inline = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    // Treat "{}" (the Terraform placeholder) and any doc missing the fields as "no key".
    if (inline && inline.trim() && inline.trim() !== '{}') {
      const k = JSON.parse(inline) as ServiceAccountKey;
      if (k.client_email && k.private_key) return k;
    }
    const path = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (path && path.trim()) {
      const k = JSON.parse(readFileSync(path, 'utf8')) as ServiceAccountKey;
      if (k.client_email && k.private_key) return k;
    }
  } catch (e) {
    console.error('Service-account key unreadable:', (e as Error).message);
  }
  return null;
}

const key = loadKey();

// Keyless mode: on Cloud Run (K_SERVICE set), running as a named SA, with no local key.
const workloadIdentity = !key && !!process.env.K_SERVICE && !!process.env.GOOGLE_SA_EMAIL;

export const driveConfigured = !!key || workloadIdentity;

/** The address users share files/folders with. */
export function serviceAccountEmail(): string | null {
  return key?.client_email ?? process.env.GOOGLE_SA_EMAIL ?? null;
}

const b64url = (input: string | Buffer): string => Buffer.from(input).toString('base64url');

const cache = new Map<string, { token: string; expiresAt: number }>();

/** Keyless: metadata-server ADC token → IAM Credentials generateAccessToken for the
 *  runtime SA with the requested scopes (self-impersonation). */
async function mintViaWorkloadIdentity(scopes: string[]): Promise<{ token: string; expiresAt: number }> {
  const adcRes = await fetch(METADATA_TOKEN_URL, { headers: { 'Metadata-Flavor': 'Google' } });
  if (!adcRes.ok) throw new Error(`Metadata token fetch failed (${adcRes.status}).`);
  const adc = (await adcRes.json()) as { access_token: string };

  const email = process.env.GOOGLE_SA_EMAIL as string;
  const res = await fetch(
    `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${email}:generateAccessToken`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${adc.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: scopes }),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`generateAccessToken failed (${res.status}). ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { accessToken: string; expireTime: string };
  return { token: data.accessToken, expiresAt: new Date(data.expireTime).getTime() };
}

/** Key mode: signed-JWT grant. */
async function mintViaKey(scopes: string[]): Promise<{ token: string; expiresAt: number }> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(
    JSON.stringify({
      iss: (key as ServiceAccountKey).client_email,
      scope: scopes.join(' '),
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  );
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const signature = signer.sign((key as ServiceAccountKey).private_key).toString('base64url');
  const assertion = `${header}.${claims}.${signature}`;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Service-account token grant failed (${res.status}). ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  return { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
}

/** Mint (and cache per scope-set) an access token for background Google API calls. */
export async function getServiceAccountToken(scopes: string[] = [DRIVE_SCOPE]): Promise<string> {
  const scope = scopes.join(' ');
  const cached = cache.get(scope);
  if (cached && Date.now() < cached.expiresAt - 60_000) return cached.token;

  const minted = key
    ? await mintViaKey(scopes)
    : workloadIdentity
      ? await mintViaWorkloadIdentity(scopes)
      : null;
  if (!minted) throw new Error('No service-account credentials configured.');
  cache.set(scope, minted);
  return minted.token;
}
