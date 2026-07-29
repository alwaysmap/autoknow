import 'server-only';
import { createPublicKey, verify as cryptoVerify } from 'crypto';
import { prisma } from './db';
import { ingestContent, hashContent } from './ingest';
import { summarizeDocument, digestToText, geminiConfigured } from './gemini';
import { getServiceAccountToken, CHAT_BOT_SCOPE } from './googleAuth';
import { t, type Locale } from './i18n';
import { LOCALE } from './preferences';
import { isTruncated } from './ingestLimits';
import { escalationHref } from './entityHref';

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

// Re-exported, not re-derived: the definition moved to lib/googleAuth beside the
// credential it gates, once the outbound poster became a second reader (#245 part c).
export { chatConfigured } from './googleAuth';

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

/**
 * The ESCALATE trigger (#245 decision 1), as a pure function so it can be tested without a
 * webhook and reused verbatim by the real `/escalate` slash command in part (d) — the
 * slash command maps onto the same internal object rather than parsing again.
 *
 * Matched against `argumentText ?? text`. `argumentText` is Chat's own "the message minus
 * the @mention", which is the field this is written for; the fallback strips ONE leading
 * `@handle` token itself, so a payload that carries only `text` (and every test that hands
 * one over) behaves identically instead of silently never triggering.
 *
 * The leading `/` is optional so that `/escalate …` — what the real slash command sends as
 * plain text on clients that do not resolve it — is the same trigger, not a near miss.
 * `\b` after the verb is what keeps "escalated the issue yesterday" from raising anything:
 * this fires only when the message BEGINS by asking for it.
 *
 * Returns both halves because both are stored and they are not the same thing: `raw` is
 * the provenance written to `originalRequest` verbatim, `topic` is what the title seeds
 * from. A trigger with no topic at all is still a trigger (`topic` is then empty) — the
 * caller falls back to the digest, because refusing would mean answering "escalate this"
 * with a syntax complaint.
 */
export function parseEscalateTrigger(text: string | null | undefined): { raw: string; topic: string } | null {
  const raw = (text ?? '').trim().replace(/^@\S+\s*/, '').trim();
  const m = /^\/?escalate\b[:\s]*/i.exec(raw);
  if (!m) return null;
  return { raw, topic: raw.slice(m[0].length).trim() };
}

/** What ONE thread snapshot did, for the caller that has to say so. Deliberately reports
 *  the OUTCOME rather than a reply string: the plain-mention path and the escalate path
 *  word the same five outcomes differently, and the ingest half must not know which. */
interface ThreadIngest {
  outcome: 'created' | 'revised' | 'unchanged' | 'no-text' | 'failed';
  /** The row, on every outcome that has one — including `unchanged`, because a duplicate
   *  escalate on an unchanged thread still has to find the escalation already on it. */
  contextUrlId?: number;
  /** The caveat sentences that actually applied, minus the leading snapshot note — the
   *  two paths open with a different first sentence but share these. */
  capped: boolean;
  unreadable: boolean;
  /** The entity the classifier attached a NEW row to, for the ack that names it. */
  attachedName?: string | null;
  error?: string;
}

/**
 * Save the thread as of now — dedupe by thread name, re-mention becomes a revision — and
 * report what happened.
 *
 * Extracted from `handleChatEvent` unchanged (#245 part b) because the escalate branch
 * needs exactly this and must not fork it: a second copy is a second place for the
 * `truncated` flag, the revision write or the dedupe to be forgotten, and the first of
 * those was already missed once here (#56 review).
 */
async function snapshotThread(
  event: ChatEvent,
  msg: NonNullable<ChatEvent['message']>,
): Promise<ThreadIngest> {
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
  const limits = { capped: snapshot.capped, unreadable: !snapshot.text };
  if (!threadText) return { outcome: 'no-text', ...limits };

  const sourceRef = `chat:${threadName}`;
  const url = `https://chat.google.com/${threadName.replace('spaces/', 'room/')}`;
  const title = `Chat: ${(event.space?.displayName || threadText.split('\n')[0]).slice(0, 90)}`;

  const existing = await prisma.contextUrl.findUnique({ where: { sourceRef }, select: { id: true, ingestedText: true, contentHash: true } });
  if (existing) {
    // Re-mention → a revision with what's new (plan §5.1), not a duplicate.
    const hash = hashContent(threadText);
    if (hash === existing.contentHash) return { outcome: 'unchanged', contextUrlId: existing.id, ...limits };
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
    return { outcome: 'revised', contextUrlId: existing.id, ...limits };
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

  if (!result.ok) return { outcome: 'failed', error: result.error ?? 'unknown error', ...limits };
  return {
    outcome: 'created',
    contextUrlId: result.contextUrlId ?? undefined,
    attachedName: result.attachedTo?.name ?? null,
    ...limits,
  };
}

/** Everything the handler knows about WHERE it is running that it cannot read off the
 *  event. Today just the origin, so a reply can carry an absolute in-app link (a Chat
 *  message is read outside the app, so a relative path is useless there). */
export interface ChatContext {
  /** e.g. `https://autoknow.alwaysmap.com`, derived by the route from the request host.
   *  Absent in tests and in any caller that has no request — the reply then names the
   *  escalation by number and omits the link, rather than emitting a broken one. */
  appOrigin?: string | null;
}

/**
 * Raise an escalation from a triggered message (#245 part b).
 *
 * THE ONE RULE THAT SHAPES THIS: every person role starts UNASSIGNED. The digest holds
 * display NAMES, not addresses, so resolving "Sven" to a Person at a webhook boundary is a
 * guess with a real human's name attached to somebody else's escalation. The UI pickers
 * are the assignment surface. Severity and org level are null for the same reason — the
 * webhook has not triaged anything, and a default would read as a judgement nobody made.
 *
 * Partner and program are NOT a guess: they are copied from what `classifyContext` already
 * wrote on the ContextUrl during ingest, which is the classification this thread has
 * already been given.
 */
async function raiseEscalation(
  trigger: { raw: string; topic: string },
  ingest: ThreadIngest,
  event: ChatEvent,
  msg: NonNullable<ChatEvent['message']>,
  ctx: ChatContext,
): Promise<{ text: string }> {
  const tr = (key: Parameters<typeof t>[1], vars?: Record<string, string | number>) =>
    t(REPLY_LOCALE, key, vars);

  // The escalate reply's own caveat sentences. The first one differs from the plain
  // path's: what a reader needs to know here is that the ESCALATION does not follow the
  // thread, which is a stronger claim than "this snapshot is a snapshot".
  const limits = say(
    tr('chatEscalationNotWatching'),
    ingest.capped && tr('chatThreadCapped', { n: THREAD_MESSAGE_LIMIT }),
    ingest.unreadable && tr('chatThreadUnreadable'),
  );

  const link = (id: number): string | null =>
    ctx.appOrigin ? `${ctx.appOrigin.replace(/\/+$/, '')}${escalationHref(id)}` : null;

  const context = ingest.contextUrlId
    ? await prisma.contextUrl.findUnique({
        where: { id: ingest.contextUrlId },
        select: { id: true, partnerId: true, projectId: true, ingestedText: true, title: true },
      })
    : null;

  // DUPLICATE CHECK, not a DB constraint: Prisma cannot express "at most one OPEN
  // escalation per contextUrlId", and the race window here is human-retype-sized. The
  // snapshot above already ran, deliberately — the thread grew, and that revision is worth
  // capturing whether or not a new escalation comes of it.
  if (context) {
    const open = await prisma.escalation.findFirst({
      where: { contextUrlId: context.id, status: 'open' },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    });
    if (open) {
      const url = link(open.id);
      return {
        text: say(
          url
            ? tr('chatEscalationExists', { n: open.id, url })
            : tr('chatEscalationExistsNoLink', { n: open.id }),
          limits,
        ),
      };
    }
  }

  // Title: the trigger's topic, then the digest's first line, then the space name. Each
  // fallback is something a human wrote or the model distilled — never a generated
  // placeholder, which would make the list unreadable at a glance.
  const digestFirstLine = (context?.ingestedText ?? '').split('\n').map((l) => l.trim()).find(Boolean);
  const title = (
    trigger.topic ||
    digestFirstLine ||
    context?.title ||
    event.space?.displayName ||
    'Escalation raised from chat'
  ).slice(0, 300);

  try {
    const escalation = await prisma.escalation.create({
      data: {
        originalRequest: trigger.raw,
        title,
        summary: context?.ingestedText ?? null,
        // Copied from the classifier's own answer, never re-derived here.
        partnerId: context?.partnerId ?? null,
        projectId: context?.projectId ?? null,
        contextUrlId: context?.id ?? null,
        raisedBy: msg.sender?.email ?? msg.sender?.displayName ?? null,
        sourceKind: 'chat',
      },
      select: { id: true },
    });
    const url = link(escalation.id);
    return {
      text: say(
        url
          ? tr('chatEscalationCreated', { n: escalation.id, url })
          : tr('chatEscalationCreatedNoLink', { n: escalation.id }),
        limits,
      ),
    };
  } catch (e) {
    // Creation fails ONLY if the database write fails, and it is reported honestly rather
    // than swallowed into the thread's "Saved" (AGENTS lesson 5). The snapshot above did
    // commit, so the ack has to distinguish "the thread is saved" from "the escalation is
    // not raised".
    console.error('[chat] escalation create failed:', e);
    return { text: tr('chatEscalationSaveFailed', { reason: e instanceof Error ? e.message : 'unknown error' }) };
  }
}

/** Handle one event; the returned object is posted as the app's reply. */
export async function handleChatEvent(
  event: ChatEvent,
  ctx: ChatContext = {},
): Promise<{ text: string } | Record<string, never>> {
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
  // The branch sits HERE — after the domain gate, before the snapshot — because an
  // escalation is content too: a sender we refuse to ingest from is a sender we refuse to
  // raise an escalation for, and putting the trigger check first would have quietly made
  // this the one path around that gate.
  const trigger = parseEscalateTrigger(msg.argumentText ?? msg.text);

  const ingest = await snapshotThread(event, msg);
  if (ingest.outcome === 'no-text') return { text: tr('chatNoText') };

  // Both paths report the same two limits; only the opening sentence differs.
  const limits = say(
    tr('chatSnapshotNote'),
    ingest.capped && tr('chatThreadCapped', { n: THREAD_MESSAGE_LIMIT }),
    ingest.unreadable && tr('chatThreadUnreadable'),
  );

  if (ingest.outcome === 'failed') {
    return { text: tr('chatSaveFailed', { reason: ingest.error ?? 'unknown error' }) };
  }

  // An escalate trigger takes over the reply once the thread is safely stored — the
  // snapshot has already happened either way, which is what makes a duplicate trigger on a
  // grown thread still capture the revision.
  if (trigger) return await raiseEscalation(trigger, ingest, event, msg, ctx);

  if (ingest.outcome === 'unchanged') return { text: tr('chatUnchanged') };
  if (ingest.outcome === 'revised') return { text: say(tr('chatUpdated'), limits) };
  const saved = ingest.attachedName
    ? tr('chatSavedLinked', { name: ingest.attachedName })
    : tr('chatSaved');
  return { text: say(saved, limits) };
}
