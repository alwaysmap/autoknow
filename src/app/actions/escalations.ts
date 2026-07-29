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
import { guarded, type ActionResult } from '../../lib/actionResult';
import { canTransition, isClosed, type EscalationStatus } from '../../lib/escalation';
import { escalationHref } from '../../lib/entityHref';
import {
  describeAssignmentChange,
  describeStatusChange,
  postEscalationChange,
} from '../../lib/escalationPostBack';

// Escalation mutations (#245 part a). Mirrors `app/actions/partners.ts`: `guarded` +
// `parseForm` + `revalidatePath`, with zod (lib/schemas) as the single gate for shape.
//
// WHO MAY DO THIS: any signed-in domain user, the same as every other mutation in the app
// (#245 decision 3). There is deliberately no per-escalation permission machinery — an
// owner or decision-maker assignment says who is ACCOUNTABLE, not who holds the buttons,
// and building a second authorization model for one entity would be the kind of mechanism
// a red-team pass exists to delete (AGENTS lesson 12).
//
// The post-back to the source chat thread (part c) hangs off the two mutations below, but
// its plumbing does NOT live here — `lib/escalationPostBack` owns it, so each action stays
// at the altitude its neighbours sit at: parse · write · revalidate · announce.

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

    // Read the three roles BEFORE the write: an assignment post describes a CHANGE, and
    // only the previous values can say whether there was one.
    const before = await prisma.escalation.findUnique({
      where: { id: escalationId },
      select: { ownerPersonId: true, decisionMakerPersonId: true, requestedOfPersonId: true },
    });

    const escalation = await prisma.escalation.update({
      where: { id: escalationId },
      data: fields,
    });
    revalidateEscalation(escalation);

    if (before) {
      const message = await describeAssignmentChange(escalationId, escalation.title, before, escalation);
      if (message) await postEscalationChange(escalationId, message);
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
      describeStatusChange(escalationId, escalation.title, status),
    );
  });
}
