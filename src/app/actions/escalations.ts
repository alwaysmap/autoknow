'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '../../lib/db';
import {
  parseForm,
  escalationFieldsSchema,
  escalationStatusUpdateSchema,
  escalationUpdateSchema,
} from '../../lib/schemas';
import { headers } from 'next/headers';
import { guarded, type ActionResult } from '../../lib/actionResult';
import {
  STATUS_DISPLAY_KEY,
  canTransition,
  isClosed,
  type EscalationStatus,
} from '../../lib/escalation';
import { escalationHref } from '../../lib/entityHref';
import { postToThread } from '../../lib/chatPost';
import { t, type Locale, type StringKey } from '../../lib/i18n';
import { LOCALE } from '../../lib/preferences';

// Escalation mutations (#245 part a). Mirrors `app/actions/partners.ts`: `guarded` +
// `parseForm` + `revalidatePath`, with zod (lib/schemas) as the single gate for shape.
//
// WHO MAY DO THIS: any signed-in domain user, the same as every other mutation in the app
// (#245 decision 3). There is deliberately no per-escalation permission machinery — an
// owner or decision-maker assignment says who is ACCOUNTABLE, not who holds the buttons,
// and building a second authorization model for one entity would be the kind of mechanism
// a red-team pass exists to delete (AGENTS lesson 12).
//
// What is NOT here: the post-back to the source chat thread. That is part (c), and it
// hangs off the two mutations below — see the note on `setEscalationStatus`.

/** The surfaces an escalation appears on. One helper because three call sites each
 *  revalidating "the list, this row, and whatever it is about" drifted apart the moment
 *  one of them forgot the partner page. */
function revalidateEscalation(e: {
  id: number;
  partnerId: number | null;
  projectId: number | null;
}) {
  revalidatePath('/escalations');
  revalidatePath(escalationHref(e.id));
  if (e.partnerId) revalidatePath(`/partners/${e.partnerId}`);
  if (e.projectId) revalidatePath(`/programs/${e.projectId}`);
}

// ---- post-back to the source chat thread (#245 part c) ----------------------------
//
// THE INVARIANT: none of this can make a mutation fail. The escalation is already written
// by the time any of it runs, so a Chat outage must not undo a close somebody just made.
// `postToThread` never throws by construction; everything else here is wrapped, and the
// worst case is a row whose delivery columns are stale — which the detail page shows
// honestly rather than hiding (AGENTS lesson 5).

/** A post has no session and no cookie to read a locale from, exactly like a webhook
 *  reply — so it goes out in the app default. Copy still lives in the catalog so a
 *  per-space locale can be plumbed later without moving prose into this file. */
const POST_LOCALE: Locale = LOCALE.default;
const tr = (key: StringKey, vars?: Record<string, string | number>) => t(POST_LOCALE, key, vars);

/** The app's public origin, derived from the request the action is serving — the same
 *  derivation `api/chat/events` uses for the inbound reply. A Chat message is read outside
 *  the app, so a relative path is useless there; when the host cannot be read the post
 *  simply carries no link rather than a broken one. */
async function appOrigin(): Promise<string | null> {
  try {
    const h = await headers();
    const host = h.get('x-forwarded-host') ?? h.get('host');
    if (!host) return null;
    const proto = h.get('x-forwarded-proto') ?? (/^(localhost|127\.0\.0\.1)/.test(host) ? 'http' : 'https');
    return `${proto}://${host}`;
  } catch {
    return null;
  }
}

/**
 * Post one change back to the thread the escalation was raised in, and record the outcome
 * on the row.
 *
 * Silent no-op for anything not raised from chat, or with no source thread: a manually
 * created escalation has nowhere to post and that is not a failure, so it must not leave
 * an error on the row.
 *
 * The two delivery columns mean exactly this, and nothing else:
 *   `lastChatPostAt`     — when a post last SUCCEEDED. Untouched by a failure, so the row
 *                          still records the last time the thread genuinely heard from us.
 *   `lastChatPostError`  — the most recent attempt's error, cleared on success. Its
 *                          presence is the badge condition, which is why it is "the latest
 *                          attempt" rather than "the last error ever seen".
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

    const origin = await appOrigin();
    const text = origin
      ? `${message} ${tr('escPostLink', { url: `${origin}${escalationHref(escalationId)}` })}`
      : message;

    const result = await postToThread(sourceRef, text);
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

export async function createEscalation(formData: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const fields = parseForm(escalationFieldsSchema, formData);
    // `sourceKind: 'manual'` is the default for this path and is not accepted from the
    // form: a record's own provenance is not something its create form gets to claim.
    // `originalRequest` stays null for the same reason — there was no original request,
    // somebody typed this straight into the app.
    const escalation = await prisma.escalation.create({
      data: { ...fields, sourceKind: 'manual' },
    });
    revalidateEscalation(escalation);
    redirect(escalationHref(escalation.id));
  });
}

export async function updateEscalation(formData: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const { escalationId, ...fields } = parseForm(escalationUpdateSchema, formData);

    // Read the three roles BEFORE the write, because an assignment is a CHANGE and the
    // thread is told about changes — re-announcing an owner who was already that owner
    // would make every unrelated title edit look like a reassignment.
    const before = await prisma.escalation.findUnique({
      where: { id: escalationId },
      select: { ownerPersonId: true, decisionMakerPersonId: true, requestedOfPersonId: true },
    });

    const escalation = await prisma.escalation.update({
      where: { id: escalationId },
      data: fields,
    });
    revalidateEscalation(escalation);

    // POST-BACK SCOPE (#245 decision 2): all three person roles, not only owner and
    // decision maker. "Requested of" is who the ask is actually pointed at, so a thread
    // that is not told about it is missing the one name it most needs; the decision's
    // headline is "ALL meaningful updates" and this is one.
    const roles: Array<{ key: StringKey; was?: number | null; now: number | null }> = [
      { key: 'escOwner', was: before?.ownerPersonId, now: escalation.ownerPersonId },
      { key: 'escDecisionMaker', was: before?.decisionMakerPersonId, now: escalation.decisionMakerPersonId },
      { key: 'escRequestedOf', was: before?.requestedOfPersonId, now: escalation.requestedOfPersonId },
    ];
    const changed = roles.filter((r) => (r.was ?? null) !== r.now);
    if (before && changed.length > 0) {
      // Names are resolved in ONE query rather than per role — three assignments in one
      // submit is an ordinary edit, not an exceptional one.
      const ids = changed.map((r) => r.now).filter((id): id is number => id != null);
      const people = ids.length
        ? await prisma.person.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
        : [];
      const nameOf = new Map(people.map((p) => [p.id, p.name]));
      const sentences = changed.map((r) =>
        r.now != null
          ? tr('escPostRoleNow', { role: tr(r.key), name: nameOf.get(r.now) ?? '' })
          : tr('escPostRoleCleared', { role: tr(r.key) }),
      );
      await postEscalationChange(
        escalationId,
        tr('escPostAssignment', {
          n: escalationId,
          title: escalation.title,
          changes: sentences.join('; '),
        }),
      );
    }
  });
}

/**
 * Close, re-open, or re-classify — the ONE writer of `status` and therefore the one
 * writer of `closedAt`.
 *
 * `closedAt` is DERIVED from the new status rather than submitted: closing stamps it,
 * re-opening clears it. A form that could post its own timestamp could report an
 * escalation as having been closed before it was raised.
 *
 * The legality check is `lib/escalation.canTransition`, not a condition spelled out here,
 * so the rule the status control renders from and the rule the boundary enforces are the
 * same function. Its refusal is a user-readable message because `guarded` returns it to
 * the dialog: the em dash is what marks it readable (see lib/actionResult).
 */
export async function setEscalationStatus(formData: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const { escalationId, status, duplicateOfId } = parseForm(
      escalationStatusUpdateSchema,
      formData,
    );

    const current = await prisma.escalation.findUnique({
      where: { id: escalationId },
      select: { status: true },
    });
    if (!current) throw new Error('That escalation no longer exists — it may have been deleted.');

    if (!canTransition(current.status as EscalationStatus, status)) {
      throw new Error(
        isClosed(current.status as EscalationStatus) && isClosed(status)
          ? 'That escalation is already closed — re-open it before closing it a different way.'
          : 'That status change is not allowed — the escalation is already in that state.',
      );
    }

    const escalation = await prisma.escalation.update({
      where: { id: escalationId },
      data: {
        status,
        closedAt: isClosed(status) ? new Date() : null,
        // Only meaningful for `duplicate`, and cleared otherwise so a re-open does not
        // leave a stale "duplicate of #12" pointing out of an open escalation.
        duplicateOfId: status === 'duplicate' ? duplicateOfId : null,
      },
    });

    revalidateEscalation(escalation);

    // The post-back, AFTER the write has committed and never before: the in-app mutation
    // must not be undone by a Chat API call. A failure lands on the row and is rendered as
    // a badge; it is never raised from here, so closing an escalation cannot fail because
    // Chat is down.
    await postEscalationChange(
      escalationId,
      tr('escPostStatus', {
        n: escalationId,
        title: escalation.title,
        status: tr(STATUS_DISPLAY_KEY[status]),
      }),
    );
  });
}
