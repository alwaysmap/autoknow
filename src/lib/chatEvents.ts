import 'server-only';
import { createPublicKey, verify as cryptoVerify } from 'crypto';
import { prisma } from './db';
import { ingestContent, hashContent } from './ingest';
import { summarizeDocument, digestToText, geminiConfigured } from './gemini';
import { getServiceAccountToken, driveConfigured, CHAT_BOT_SCOPE } from './googleAuth';

// Google Chat @mention ingestion (plan §5.1 / slice 4). Chat POSTs interaction
// events to our endpoint with a JWT minted by chat@system.gserviceaccount.com whose
// audience is our GCP project number — verifying that is the route's entire
// authentication. On MESSAGE we save the thread-as-of-now (dedupe by thread name;
// re-mentions become revisions) and the JSON we return IS the app's in-thread reply.

const CHAT_ISSUER = 'chat@system.gserviceaccount.com';
const JWK_URL = `https://www.googleapis.com/service_accounts/v1/jwk/${CHAT_ISSUER}`;

export const chatConfigured = !!process.env.GOOGLE_PROJECT_NUMBER && driveConfigured;

interface Jwk { kid: string; n: string; e: string; kty: string }
let jwkCache: { keys: Jwk[]; fetchedAt: number } | null = null;

async function googleChatKeys(): Promise<Jwk[]> {
  if (jwkCache && Date.now() - jwkCache.fetchedAt < 3600_000) return jwkCache.keys;
  const res = await fetch(JWK_URL);
  if (!res.ok) throw new Error(`JWK fetch failed (${res.status})`);
  jwkCache = { keys: ((await res.json()) as { keys: Jwk[] }).keys, fetchedAt: Date.now() };
  return jwkCache.keys;
}

/** Verify the bearer JWT Chat sends: signature, issuer, audience, expiry.
 *  Chat signs with EITHER the project number or the configured app URL as the
 *  audience (console setting), so both are accepted; the signature check against
 *  Google's keys is what makes either safe. */
export async function verifyChatToken(bearer: string | null, expectedUrl?: string | null): Promise<boolean> {
  if (!bearer || !process.env.GOOGLE_PROJECT_NUMBER) {
    console.log('[chat] reject: no bearer token (probe or misconfig)');
    return false;
  }
  const parts = bearer.split('.');
  if (parts.length !== 3) {
    console.log('[chat] reject: bearer is not a JWT');
    return false;
  }
  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (payload.iss !== CHAT_ISSUER) {
      console.log(`[chat] reject: issuer=${JSON.stringify(payload.iss)} (want ${CHAT_ISSUER})`);
      return false;
    }
    const audOk =
      String(payload.aud) === process.env.GOOGLE_PROJECT_NUMBER ||
      (!!expectedUrl && String(payload.aud) === expectedUrl);
    if (!audOk) {
      console.log(`[chat] JWT rejected: aud=${JSON.stringify(payload.aud)} (expected ${process.env.GOOGLE_PROJECT_NUMBER} or ${expectedUrl})`);
      return false;
    }
    if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) return false;

    const jwk = (await googleChatKeys()).find((k) => k.kid === header.kid);
    if (!jwk) {
      console.log(`[chat] reject: unknown signing key kid=${header.kid}`);
      return false;
    }
    const pub = createPublicKey({ key: jwk as unknown as import('crypto').JsonWebKey, format: 'jwk' });
    return cryptoVerify(
      'RSA-SHA256',
      Buffer.from(`${parts[0]}.${parts[1]}`),
      pub,
      Buffer.from(parts[2], 'base64url'),
    );
  } catch {
    return false;
  }
}

// Minimal slice of the Chat interaction-event shape we use.
export interface ChatEvent {
  type: string; // MESSAGE | ADDED_TO_SPACE | REMOVED_FROM_SPACE | …
  message?: {
    name: string;
    text?: string;
    argumentText?: string; // text minus the @mention
    thread?: { name: string };
    sender?: { displayName?: string; email?: string };
  };
  space?: { name: string; displayName?: string };
}

/** Fetch every message in the thread via app auth (the app is a member now). */
async function fetchThreadText(spaceName: string, threadName: string): Promise<string | null> {
  try {
    const token = await getServiceAccountToken([CHAT_BOT_SCOPE]);
    const params = new URLSearchParams({
      filter: `thread.name = "${threadName}"`,
      pageSize: '100',
    });
    const res = await fetch(`https://chat.googleapis.com/v1/${spaceName}/messages?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { messages?: Array<{ text?: string; sender?: { displayName?: string } }> };
    const lines = (data.messages ?? [])
      .map((m) => `${m.sender?.displayName ?? 'someone'}: ${m.text ?? ''}`.trim())
      .filter((l) => l.length > 2);
    return lines.length ? lines.join('\n') : null;
  } catch {
    return null;
  }
}

/** Handle one event; the returned object is posted as the app's reply. */
export async function handleChatEvent(event: ChatEvent): Promise<{ text: string } | Record<string, never>> {
  if (event.type === 'ADDED_TO_SPACE') {
    return { text: 'AutoKnow is here — @mention me on any message and I will save its thread as program/partner context.' };
  }
  if (event.type !== 'MESSAGE' || !event.message) return {};
  if (!geminiConfigured) return { text: 'AI ingestion is off (no GEMINI_API_KEY on the server) — nothing was saved.' };

  // Single-domain guarantee at the code level: never ingest content from a sender
  // outside AUTH_ALLOWED_DOMAIN, independent of Workspace allowlist config (plan §7b).
  const allowedDomain = process.env.AUTH_ALLOWED_DOMAIN;
  const senderEmail = event.message.sender?.email ?? '';
  if (allowedDomain && !senderEmail.toLowerCase().endsWith(`@${allowedDomain.toLowerCase()}`)) {
    return { text: `AutoKnow only ingests messages from @${allowedDomain} accounts.` };
  }

  const msg = event.message;
  const spaceName = event.space?.name ?? msg.thread?.name?.split('/threads/')[0] ?? '';
  const threadName = msg.thread?.name ?? msg.name;
  const sender = msg.sender?.email ?? msg.sender?.displayName ?? 'chat';

  // Thread-as-of-now; degrade to the mentioning message when history is off.
  const threadText = (spaceName && (await fetchThreadText(spaceName, threadName)))
    || (msg.argumentText || msg.text || '').trim();
  if (!threadText) return { text: 'I could not read any text to save (is space history on?).' };

  const sourceRef = `chat:${threadName}`;
  const url = `https://chat.google.com/${threadName.replace('spaces/', 'room/')}`;
  const title = `Chat: ${(event.space?.displayName || threadText.split('\n')[0]).slice(0, 90)}`;

  const existing = await prisma.contextUrl.findUnique({ where: { sourceRef }, select: { id: true, ingestedText: true, contentHash: true } });
  if (existing) {
    // Re-mention → a revision with what's new (plan §5.1), not a duplicate.
    const hash = hashContent(threadText);
    if (hash === existing.contentHash) return { text: 'Already saved — nothing new in this thread since last time.' };
    const digest = await summarizeDocument(threadText, existing.ingestedText ?? undefined);
    const digestText = digestToText(digest);
    await prisma.$transaction([
      prisma.contextUrl.update({
        where: { id: existing.id },
        data: { ingestedText: digestText, contentHash: hash, lastCheckedAt: new Date(), lastChangedAt: new Date() },
      }),
      prisma.contextRevision.create({
        data: { contextUrlId: existing.id, contentHash: hash, sourceStatus: digest.sourceStatus, digest: digestText, delta: (digest.delta ?? '').trim() || null },
      }),
    ]);
    return { text: 'Updated — saved what’s new in this thread.' };
  }

  const result = await ingestContent({
    url,
    title,
    text: threadText,
    source: { kind: 'chat', mode: 'snapshot', sourceRef },
    mode: 'snapshot',
    modeSource: 'inferred',
    anchor: null, // global classifier places it
    addedBy: sender,
  });

  if (!result.ok) return { text: `Could not save this thread: ${result.error ?? 'unknown error'}` };
  const linked = result.attachedTo?.name ? ` — linked to ${result.attachedTo.name}` : '';
  return { text: `Saved${linked}. It will appear in the activity feed and leadership summaries.` };
}
