import 'server-only';
import { createPublicKey, verify as cryptoVerify } from 'crypto';
import { prisma } from './db';
import { ingestContent, hashContent } from './ingest';
import { summarizeDocument, digestToText, geminiConfigured } from './gemini';
import { getServiceAccountToken, driveConfigured, CHAT_BOT_SCOPE } from './googleAuth';
import { t, type Locale } from './i18n';
import { LOCALE } from './preferences';
import { isTruncated } from './ingestLimits';

// Google Chat @mention ingestion (plan §5.1 / slice 4). Chat POSTs interaction
// events to our endpoint with a JWT minted by chat@system.gserviceaccount.com whose
// audience is our GCP project number — verifying that is the route's entire
// authentication. On MESSAGE we save the thread-as-of-now (dedupe by thread name;
// re-mentions become revisions) and the JSON we return IS the app's in-thread reply.
//
// WHAT THAT REPLY MUST SAY (#56, the scaling ADR's decision 3): this connector captures
// ONE THREAD's first THREAD_MESSAGE_LIMIT messages as a SNAPSHOT. It is not a room watch —
// Chat rows are `snapshot` mode, so the refresh cycle never re-reads them and later
// messages are invisible until a human @mentions the app again. The ack therefore names the
// thread, the message cap when it is hit, and the snapshot; "room" and "watched" are words
// this connector may not use (docs/SCALING_LIMITS.md §3).

/** A Chat webhook carries no session and no cookie, so there is no user locale to read —
 *  the reply goes out in the app default. The copy still lives in the catalog so a
 *  per-space locale can be plumbed later without moving prose back into this file. */
const REPLY_LOCALE: Locale = LOCALE.default;

const CHAT_ISSUER = 'chat@system.gserviceaccount.com';
const JWK_URL = `https://www.googleapis.com/service_accounts/v1/jwk/${CHAT_ISSUER}`;

// Chat apps on the add-on framework (every config the current console creates) are
// invoked by the gsuiteaddons runtime, which signs with a standard Google ID token
// (issuer accounts.google.com) minted for the project's Google-managed add-ons
// service account — NOT the legacy chat@system JWT. Both token shapes are accepted
// below; the add-on token is bound to this project via that SA's email, which
// embeds our project number.
const ADDON_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const OIDC_JWK_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const addonServiceAccount = () =>
  `service-${process.env.GOOGLE_PROJECT_NUMBER}@gcp-sa-gsuiteaddons.iam.gserviceaccount.com`;

export const chatConfigured = !!process.env.GOOGLE_PROJECT_NUMBER && driveConfigured;

interface Jwk { kid: string; n: string; e: string; kty: string }
const jwkCaches = new Map<string, { keys: Jwk[]; fetchedAt: number }>();

async function signingKeys(url: string): Promise<Jwk[]> {
  const hit = jwkCaches.get(url);
  if (hit && Date.now() - hit.fetchedAt < 3600_000) return hit.keys;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`JWK fetch failed (${res.status})`);
  const keys = ((await res.json()) as { keys: Jwk[] }).keys;
  jwkCaches.set(url, { keys, fetchedAt: Date.now() });
  return keys;
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

    const isLegacy = payload.iss === CHAT_ISSUER;
    const isAddon = ADDON_ISSUERS.includes(payload.iss);
    if (!isLegacy && !isAddon) {
      console.log(`[chat] reject: issuer=${JSON.stringify(payload.iss)} (want ${CHAT_ISSUER} or accounts.google.com)`);
      return false;
    }

    if (isLegacy) {
      const audOk =
        String(payload.aud) === process.env.GOOGLE_PROJECT_NUMBER ||
        (!!expectedUrl && String(payload.aud) === expectedUrl);
      if (!audOk) {
        console.log(`[chat] JWT rejected: aud=${JSON.stringify(payload.aud)} (expected ${process.env.GOOGLE_PROJECT_NUMBER} or ${expectedUrl})`);
        return false;
      }
    } else {
      // Add-on runtime ID token: the project binding is the Google-managed
      // gsuiteaddons SA email (contains our project number) with a verified-email
      // claim; the Google-signature check below makes the claim trustworthy. The
      // audience varies by runtime version, so log it rather than gate on it.
      if (payload.email !== addonServiceAccount() || payload.email_verified !== true) {
        console.log(`[chat] reject: add-on token email=${JSON.stringify(payload.email)} (want ${addonServiceAccount()})`);
        return false;
      }
      console.log(`[chat] add-on token accepted pending signature; aud=${JSON.stringify(payload.aud)}`);
    }

    if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) return false;

    const jwkUrl = isLegacy ? JWK_URL : OIDC_JWK_URL;
    const jwk = (await signingKeys(jwkUrl)).find((k) => k.kid === header.kid);
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

// The add-on runtime (UA Google-gsuiteaddons) wraps the same information in a
// per-interaction envelope under `chat` instead of a top-level `type`.
interface AddonEnvelope {
  chat?: {
    user?: { displayName?: string; email?: string };
    messagePayload?: { message?: ChatEvent['message']; space?: ChatEvent['space'] };
    addedToSpacePayload?: { space?: ChatEvent['space'] };
    removedFromSpacePayload?: { space?: ChatEvent['space'] };
  };
}

/** Normalize either event framing to the legacy ChatEvent; flags add-on framing so
 *  the route can wrap the reply in the add-on response format. */
export function normalizeChatEvent(body: unknown): { event: ChatEvent; addon: boolean } | null {
  const legacy = body as ChatEvent;
  if (legacy && typeof legacy.type === 'string') return { event: legacy, addon: false };

  const chat = (body as AddonEnvelope)?.chat;
  if (!chat) return null;
  if (chat.messagePayload?.message) {
    const m = chat.messagePayload.message;
    return {
      addon: true,
      event: {
        type: 'MESSAGE',
        // `chat.user` is the Chat ADD-ON ENVELOPE's sender — a different user from the
        // signed-in one, arriving in a webhook payload rather than a session, so the
        // getCurrentUser rule (ADR session-is-the-only-source-of-who-i-am) does not apply to it.
        // eslint-disable-next-line no-restricted-syntax
        message: { ...m, sender: { displayName: m.sender?.displayName ?? chat.user?.displayName, email: m.sender?.email ?? chat.user?.email } },
        space: chat.messagePayload.space,
      },
    };
  }
  if (chat.addedToSpacePayload) return { addon: true, event: { type: 'ADDED_TO_SPACE', space: chat.addedToSpacePayload.space } };
  if (chat.removedFromSpacePayload) return { addon: true, event: { type: 'REMOVED_FROM_SPACE', space: chat.removedFromSpacePayload.space } };
  // Unknown add-on payload (slash command, card click, …): log the SHAPE only — keys
  // carry no message content or PII, and are exactly what's needed to extend this.
  console.log(`[chat] unmapped add-on payload keys=${JSON.stringify(Object.keys(chat))}`);
  return { addon: true, event: { type: 'UNKNOWN' } };
}

/** Wrap a reply message in the add-on response format when the event came through
 *  the add-on runtime; legacy events post the message JSON directly. */
export function formatChatReply(reply: { text: string } | Record<string, never>, addon: boolean): object {
  if (!addon || !('text' in reply)) return reply;
  return { hostAppDataAction: { chatDataAction: { createMessageAction: { message: { text: reply.text } } } } };
}

/** How many of a thread's messages one snapshot reads. There is deliberately NO pagination
 *  loop — windowing a long thread is a retrieval-quality change the scaling ADR defers with
 *  chunking (decision 4). The cap is declared in the ack instead of being silent. */
export const THREAD_MESSAGE_LIMIT = 100;

export interface ThreadSnapshot {
  /** Null when the thread could not be read at all (no history, no permission, API down). */
  text: string | null;
  /** The thread has more messages than this snapshot read. */
  capped: boolean;
}

/** Read the first THREAD_MESSAGE_LIMIT messages of ONE thread via app auth (the app is a
 *  member now), reporting whether more were left behind. */
async function fetchThreadText(spaceName: string, threadName: string): Promise<ThreadSnapshot> {
  try {
    const token = await getServiceAccountToken([CHAT_BOT_SCOPE]);
    const params = new URLSearchParams({
      filter: `thread.name = "${threadName}"`,
      pageSize: String(THREAD_MESSAGE_LIMIT),
    });
    const res = await fetch(`https://chat.googleapis.com/v1/${spaceName}/messages?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { text: null, capped: false };
    const data = (await res.json()) as {
      messages?: Array<{ text?: string; sender?: { displayName?: string } }>;
      nextPageToken?: string;
    };
    const messages = data.messages ?? [];
    const lines = messages
      .map((m) => `${m.sender?.displayName ?? 'someone'}: ${m.text ?? ''}`.trim())
      .filter((l) => l.length > 2);
    // Chat's own "there is more" answer, with the page size as the fallback for a response
    // that omits it — either way the user is told, never quietly given a partial thread.
    const capped = !!data.nextPageToken || messages.length >= THREAD_MESSAGE_LIMIT;
    return { text: lines.length ? lines.join('\n') : null, capped };
  } catch {
    return { text: null, capped: false };
  }
}

/** Join the sentences one ack is made of. Each limit that applied gets its own sentence, so
 *  the ack grows exactly as much as the truth requires. */
const say = (...parts: Array<string | false | null>) => parts.filter(Boolean).join(' ');

/** Handle one event; the returned object is posted as the app's reply. */
export async function handleChatEvent(event: ChatEvent): Promise<{ text: string } | Record<string, never>> {
  const tr = (key: Parameters<typeof t>[1], vars?: Record<string, string | number>) =>
    t(REPLY_LOCALE, key, vars);

  if (event.type === 'ADDED_TO_SPACE') {
    return { text: tr('chatAddedToSpace', { n: THREAD_MESSAGE_LIMIT }) };
  }
  if (event.type !== 'MESSAGE' || !event.message) return {};
  if (!geminiConfigured) return { text: tr('chatAiOff') };

  // Single-domain guarantee at the code level: never ingest content from a sender
  // outside AUTH_ALLOWED_DOMAIN, independent of Workspace allowlist config (plan §7b).
  const allowedDomain = process.env.AUTH_ALLOWED_DOMAIN;
  const senderEmail = event.message.sender?.email ?? '';
  if (allowedDomain && !senderEmail.toLowerCase().endsWith(`@${allowedDomain.toLowerCase()}`)) {
    return { text: tr('chatDomainOnly', { domain: allowedDomain }) };
  }

  const msg = event.message;
  const spaceName = event.space?.name ?? msg.thread?.name?.split('/threads/')[0] ?? '';
  const threadName = msg.thread?.name ?? msg.name;
  const sender = msg.sender?.email ?? msg.sender?.displayName ?? 'chat';

  // Thread-as-of-now; degrade to the mentioning message when history is off. That degrade
  // used to be SILENT — the ack said "saved" whether it had the thread or one message — so
  // it is now reported as its own sentence (#56: the pattern is a boundary that fails safe
  // but says nothing).
  const snapshot: ThreadSnapshot = spaceName
    ? await fetchThreadText(spaceName, threadName)
    : { text: null, capped: false };
  const threadText = snapshot.text ?? (msg.argumentText || msg.text || '').trim();
  if (!threadText) return { text: tr('chatNoText') };

  // The sentences that state which limits actually applied to THIS save.
  const limits = say(
    tr('chatSnapshotNote'),
    snapshot.capped && tr('chatThreadCapped', { n: THREAD_MESSAGE_LIMIT }),
    !snapshot.text && tr('chatThreadUnreadable'),
  );

  const sourceRef = `chat:${threadName}`;
  const url = `https://chat.google.com/${threadName.replace('spaces/', 'room/')}`;
  const title = `Chat: ${(event.space?.displayName || threadText.split('\n')[0]).slice(0, 90)}`;

  const existing = await prisma.contextUrl.findUnique({ where: { sourceRef }, select: { id: true, ingestedText: true, contentHash: true } });
  if (existing) {
    // Re-mention → a revision with what's new (plan §5.1), not a duplicate.
    const hash = hashContent(threadText);
    if (hash === existing.contentHash) return { text: tr('chatUnchanged') };
    const digest = await summarizeDocument(threadText, existing.ingestedText ?? undefined);
    const digestText = digestToText(digest);
    await prisma.$transaction([
      prisma.contextUrl.update({
        where: { id: existing.id },
        // truncated too: a thread that grows past the cap is lossy like any other source.
        // This writer used to omit it, so a growing thread was never flagged (#56 review).
        data: { ingestedText: digestText, contentHash: hash, truncated: isTruncated(threadText),
          lastCheckedAt: new Date(), lastChangedAt: new Date() },
      }),
      prisma.contextRevision.create({
        data: { contextUrlId: existing.id, contentHash: hash, sourceStatus: digest.sourceStatus, digest: digestText, delta: (digest.delta ?? '').trim() || null },
      }),
    ]);
    return { text: say(tr('chatUpdated'), limits) };
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

  if (!result.ok) return { text: tr('chatSaveFailed', { reason: result.error ?? 'unknown error' }) };
  const saved = result.attachedTo?.name
    ? tr('chatSavedLinked', { name: result.attachedTo.name })
    : tr('chatSaved');
  return { text: say(saved, limits) };
}
