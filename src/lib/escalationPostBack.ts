import 'server-only';
import { after } from 'next/server';
import { headers } from 'next/headers';
import { prisma } from './db';
import { postToThread } from './chatPost';
import { absoluteUrl, originFromHeaders } from './appOrigin';
import { escalationHref } from './entityHref';
import { STATUS_DISPLAY_KEY, type EscalationStatus } from './escalation';
import { t, type Locale, type StringKey } from './i18n';
import { LOCALE } from './preferences';

// Telling the source chat thread what changed (#245 part c) — the plumbing, so that
// `app/actions/escalations` reads as "parse · write · revalidate · announce" and stays at
// the altitude of its neighbour `app/actions/partners`.
//
// THE INVARIANT, and the reason this is a module rather than a few lines inline: none of
// it may make a mutation fail, and none of it may make a user wait. The user's intent when
// they close an escalation is to close the escalation — the transaction boundary is the
// APP's write, and telling Chat about it is a consequence of that write, not part of it.
//
// So the announcement is scheduled with `after()` (next/server), which runs it once the
// response has already been sent. Awaiting it inline was correct but not sufficient: it
// could not FAIL the close, yet it still put a Chat API round-trip between the user's
// click and their answer, which is the same "holding up the action" in a slower costume.
// `after` is the right primitive rather than a bare un-awaited promise because the platform
// keeps the instance alive for it — a floating promise on Cloud Run can be frozen the
// moment the response flushes, losing both the post AND the row update that records it.
//
// `postToThread` never throws by construction; everything below is wrapped besides. The
// worst case is a row whose delivery columns are stale — which the detail page shows
// honestly rather than hiding (AGENTS lesson 5).

/** A post has no session and no cookie to read a locale from, exactly like a webhook
 *  reply — so it goes out in the app default. Copy still lives in the catalog so a
 *  per-space locale can be plumbed later without moving prose into code. */
const POST_LOCALE: Locale = LOCALE.default;
const tr = (key: StringKey, vars?: Record<string, string | number>) => t(POST_LOCALE, key, vars);

/** The three roles an assignment post can name, paired with the label each reads under. */
const ROLE_LABELS = [
  { field: 'ownerPersonId', key: 'escOwner' },
  { field: 'decisionMakerPersonId', key: 'escDecisionMaker' },
  { field: 'requestedOfPersonId', key: 'escRequestedOf' },
] as const satisfies ReadonlyArray<{ field: string; key: StringKey }>;

export type EscalationRoles = { [K in (typeof ROLE_LABELS)[number]['field']]: number | null };

/** What to say about a status change. */
function describeStatusChange(
  id: number,
  title: string,
  status: EscalationStatus,
): string {
  return tr('escPostStatus', { n: id, title, status: tr(STATUS_DISPLAY_KEY[status]) });
}

/**
 * What to say about an assignment change, or null when nothing was assigned or cleared.
 *
 * NULL IS THE POINT: an assignment is a CHANGE, and re-announcing an owner who was already
 * that owner would make every unrelated title edit read as a reassignment — after which
 * the thread learns to ignore these posts entirely.
 *
 * Scope is all THREE roles, not only owner and decision maker (#245 decision 2's headline
 * is "ALL meaningful updates"): "requested of" is who the ask is actually pointed at, so a
 * thread not told about it is missing the one name it most needs.
 */
async function describeAssignmentChange(
  id: number,
  title: string,
  before: EscalationRoles,
  now: EscalationRoles,
): Promise<string | null> {
  const changed = ROLE_LABELS.filter((r) => (before[r.field] ?? null) !== (now[r.field] ?? null));
  if (changed.length === 0) return null;

  // ONE query for the names, not one per role — three assignments in a single submit is an
  // ordinary edit, not an exceptional one.
  const ids = changed.map((r) => now[r.field]).filter((v): v is number => v != null);
  const people = ids.length
    ? await prisma.person.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
    : [];
  const nameOf = new Map(people.map((p) => [p.id, p.name]));

  const sentences = changed.map((r) => {
    const assigned = now[r.field];
    return assigned != null
      ? tr('escPostRoleNow', { role: tr(r.key), name: nameOf.get(assigned) ?? '' })
      : tr('escPostRoleCleared', { role: tr(r.key) });
  });
  return tr('escPostAssignment', { n: id, title, changes: sentences.join('; ') });
}

/**
 * Post one change back to the thread the escalation was raised in, and record the outcome.
 *
 * Silent no-op for anything not raised from chat, or with no source thread: a manually
 * created escalation has nowhere to post, which is not a failure and must not leave an
 * error on the row.
 *
 * The two delivery columns mean exactly this, and nothing else:
 *   `lastChatPostAt`    — when a post last SUCCEEDED. Untouched by a failure, so the row
 *                         still records the last time the thread genuinely heard from us.
 *   `lastChatPostError` — the most recent attempt's error, cleared on success. Its presence
 *                         is the badge condition, which is why it is "the latest attempt"
 *                         rather than "the last error ever seen".
 */
async function postEscalationChange(escalationId: number, message: string): Promise<void> {
  try {
    const escalation = await prisma.escalation.findUnique({
      where: { id: escalationId },
      select: { sourceKind: true, contextUrl: { select: { sourceRef: true } } },
    });
    if (!escalation || escalation.sourceKind !== 'chat') return;
    const sourceRef = escalation.contextUrl?.sourceRef;
    if (!sourceRef) return;

    // Through the ONE origin derivation, shared with the inbound webhook reply — a Chat
    // message is read outside the app, so a relative path resolves against
    // chat.google.com and goes nowhere.
    const url = absoluteUrl(await requestOrigin(), escalationHref(escalationId));
    const text = url ? `${message} ${tr('escPostLink', { url })}` : message;

    const result = await postToThread(sourceRef, text);
    // A SKIP leaves both columns exactly as they were. Nothing was sent, so there is no
    // delivery to stamp and no failure to report — and stamping one anyway is how a
    // developer machine, where Chat is never configured, would tell every reader that the
    // thread had been told.
    if (result.ok && result.skipped) return;
    await prisma.escalation.update({
      where: { id: escalationId },
      data: result.ok
        ? { lastChatPostAt: new Date(), lastChatPostError: null }
        : { lastChatPostError: result.error },
    });
  } catch (e) {
    // Reached only if the DB write above fails. Logged, never rethrown — the mutation this
    // rides behind has already committed and is not this function's to undo.
    console.error('[escalations] post-back bookkeeping failed:', e);
  }
}

/**
 * Schedule the announcement of a status change — AFTER the response is sent.
 *
 * Returns void and is deliberately NOT awaited by its callers: the close is already
 * committed and already revalidated by the time this is reached, so there is nothing left
 * for the user to wait for.
 */
export function announceStatusChange(
  escalationId: number,
  title: string,
  status: EscalationStatus,
): void {
  after(async () => {
    await postEscalationChange(escalationId, describeStatusChange(escalationId, title, status));
  });
}

/**
 * The same, for assignments. The MESSAGE-BUILDING moves inside the callback too, not just
 * the post: composing it costs a query to name the people, and that query is no more the
 * user's business to wait for than the HTTP call it feeds.
 */
export function announceAssignmentChange(
  escalationId: number,
  title: string,
  before: EscalationRoles,
  now: EscalationRoles,
): void {
  after(async () => {
    const message = await describeAssignmentChange(escalationId, title, before, now);
    if (message) await postEscalationChange(escalationId, message);
  });
}

/** The serving request's origin, or null outside a request (and in tests). */
async function requestOrigin(): Promise<string | null> {
  try {
    return originFromHeaders(await headers());
  } catch {
    return null;
  }
}
