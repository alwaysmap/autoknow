'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '../../lib/db';
import {
  parseForm,
  initiativeFieldsSchema,
  initiativeUpdateSchema,
  initiativeArchiveSchema,
  initiativeAddPartnersSchema,
  initiativeRemovePartnerSchema,
  initiativeLinkDeviceSchema,
  initiativeUnlinkDeviceSchema,
} from '../../lib/schemas';
import { guarded, type ActionResult } from '../../lib/actionResult';
import { getCurrentUser } from '../../lib/session';
import { parseSopInput } from '../../lib/sop';
import { NO_OWNER } from '../../lib/owner';
import { getTemplateWithPhases, cloneTemplateGraph, type NameSeries } from '../../lib/programTemplates';
import { createProgramFromTemplate } from '../../lib/createProgramFromTemplate';
import { indexEntity } from '../../lib/search';

// Initiative mutations (gh-286 part c). Mirrors `app/actions/escalations.ts`: `guarded`
// + `parseForm` + `revalidatePath`, zod (lib/schemas) as the single gate for shape.
// Same authorization stance as every other mutation: any signed-in domain user.
//
// The invariants these actions own (the schema deliberately does not encode them):
//  - one ACTIVE copy per (initiative, partner) — adds skip members that already have one;
//  - removal cancels the copy and KEEPS it (history), and marks the join `removed`;
//  - re-adding flips the one join row back to active and instantiates a FRESH copy;
//  - the workflow definition is a private snapshot made at creation, never re-pointed.

/** "X workflow", then "X workflow 2" — the snapshot's name is invisible in lists (it is
 *  hidden by the back-relation) but must still clear @@unique([name, isBuiltIn]). */
const snapshotName = (initiativeName: string): NameSeries => (n) =>
  n === 1 ? `${initiativeName} workflow` : `${initiativeName} workflow ${n}`;

function revalidateInitiative(initiativeId: number, partnerIds: number[] = []) {
  revalidatePath('/initiatives');
  revalidatePath(`/initiatives/${initiativeId}`);
  for (const id of partnerIds) revalidatePath(`/partners/${id}`);
}

export async function createInitiative(formData: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const fields = parseForm(initiativeFieldsSchema, formData);
    // Validate the SOURCE before cloning: an empty template would only fail later, at
    // the first partner add — the person who picked it is the one who can fix it.
    const source = await getTemplateWithPhases(fields.templateId);
    if (!source || source.phases.length === 0) {
      throw new Error('Unknown or empty template — pick a template that has phases');
    }
    const createdBy = (await getCurrentUser()).handle;
    const targetDate = parseSopInput(fields.targetMonth ?? '');
    const initiative = await prisma.$transaction(async (tx) => {
      const snapshot = await cloneTemplateGraph(tx, fields.templateId, snapshotName(fields.name), createdBy);
      return tx.initiative.create({
        data: {
          name: fields.name,
          description: fields.description,
          targetDate,
          templateId: snapshot.id,
          createdBy,
        },
      });
    });
    // Initial membership, if the form assigned any (owner call 2026-08-08). After the
    // creation transaction — a copy instantiation failure must not unwind the
    // initiative itself; the page shows whoever landed.
    if (fields.partnerIds && fields.partnerIds.length > 0) {
      await addMembers(initiative, fields.partnerIds, fields.targetMonth, createdBy);
    }
    // After membership lands: the index text carries the members' names, and a
    // failed embedding never fails the write (indexEntity swallows).
    await indexEntity('initiative', initiative.id);
    revalidateInitiative(initiative.id, fields.partnerIds ?? []);
    redirect(`/initiatives/${initiative.id}`);
  });
}

export async function updateInitiative(formData: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const fields = parseForm(initiativeUpdateSchema, formData);
    await prisma.initiative.update({
      where: { id: fields.initiativeId },
      data: {
        name: fields.name,
        description: fields.description,
        // Applies to FUTURE adds only — existing copies keep their own dates (gh-286
        // decision 4: the default is applied at add time, never cascaded).
        targetDate: parseSopInput(fields.targetMonth ?? ''),
      },
    });
    await indexEntity('initiative', fields.initiativeId);
    revalidateInitiative(fields.initiativeId);
  });
}

export async function archiveInitiative(formData: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const { initiativeId } = parseForm(initiativeArchiveSchema, formData);
    await prisma.initiative.update({ where: { id: initiativeId }, data: { isArchived: true } });
    revalidateInitiative(initiativeId);
  });
}

/**
 * The membership-add core, shared by `addPartners` and creation-time assignment
 * (owner call 2026-08-08): per partner, upsert the join row to active and instantiate
 * a fresh copy of the snapshot. A partner that is already an active member is skipped —
 * the filters that FIND partners never mutate membership, so a batch may legitimately
 * include existing members and must not double-instantiate (gh-286 decision 2).
 * Rejects the whole batch when any id names nobody (AGENTS lesson 3) — a partial apply
 * would leave the caller guessing which of their picks stuck.
 */
async function addMembers(
  initiative: { id: number; name: string; templateId: number; targetDate: Date | null },
  partnerIds: number[],
  targetMonth: string | null,
  createdBy: string,
): Promise<void> {
  const partners = await prisma.partner.findMany({ where: { id: { in: partnerIds } } });
  const found = new Set(partners.map((p) => p.id));
  const missing = partnerIds.filter((id) => !found.has(id));
  if (missing.length > 0) throw new Error(`Unknown partner id(s) — refresh and re-select: ${missing.join(', ')}`);

  const effectiveDate = parseSopInput(targetMonth ?? '') ?? initiative.targetDate;

  for (const partner of partners) {
    const existing = await prisma.initiativePartner.findUnique({
      where: { initiativeId_partnerId: { initiativeId: initiative.id, partnerId: partner.id } },
    });
    if (existing?.status === 'active') continue;
    await prisma.initiativePartner.upsert({
      where: { initiativeId_partnerId: { initiativeId: initiative.id, partnerId: partner.id } },
      create: { initiativeId: initiative.id, partnerId: partner.id },
      update: { status: 'active', joinedAt: new Date(), removedAt: null },
    });
    // The copy starts unowned — assigning a Googler is a later, per-copy act on the
    // program page; auto-assigning the adder would fabricate an ownership fact.
    await createProgramFromTemplate({
      name: `${initiative.name} — ${partner.name}`,
      partnerId: partner.id,
      templateId: initiative.templateId,
      owner: NO_OWNER,
      sopDate: effectiveDate,
      initiativeId: initiative.id,
      products: { hasGas: false, hasGbi: false, hasDigitalKey: false, hasAap: false },
      createdBy,
    });
  }
}

export async function addPartners(formData: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const fields = parseForm(initiativeAddPartnersSchema, formData);
    const initiative = await prisma.initiative.findUnique({ where: { id: fields.initiativeId } });
    if (!initiative) throw new Error('Unknown initiative — it may have been deleted');
    if (initiative.isArchived) throw new Error('Initiative is archived — unarchive it to change membership');
    const createdBy = (await getCurrentUser()).handle;
    await addMembers(initiative, fields.partnerIds, fields.targetMonth, createdBy);
    // Membership is part of the index text (initiativeIndexText), so it reindexes here
    // and on removal — not only on create/update of the initiative's own fields.
    await indexEntity('initiative', initiative.id);
    revalidateInitiative(initiative.id, fields.partnerIds);
  });
}

/** Remove a partner: cancel their active copy (kept — it is the history) and mark the
 *  join `removed`. Copies already complete or cancelled are left exactly as they are. */
export async function removePartner(formData: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const { initiativeId, partnerId } = parseForm(initiativeRemovePartnerSchema, formData);
    const membership = await prisma.initiativePartner.findUnique({
      where: { initiativeId_partnerId: { initiativeId, partnerId } },
    });
    if (!membership || membership.status !== 'active') throw new Error('Not an active member — nothing to remove');

    await prisma.$transaction(async (tx) => {
      await tx.initiativePartner.update({
        where: { id: membership.id },
        data: { status: 'removed', removedAt: new Date() },
      });
      const copy = await tx.project.findFirst({
        where: { initiativeId, partnerId, lifecycle: 'active', isArchived: false },
      });
      if (copy) {
        await tx.project.update({ where: { id: copy.id }, data: { lifecycle: 'cancelled' } });
      }
    });
    // The removed partner's name leaves the index text with them (see addPartners).
    await indexEntity('initiative', initiativeId);
    revalidateInitiative(initiativeId, [partnerId]);
  });
}

/**
 * Link one of the member's real device Programs (head units) to their membership
 * (autoknow-hcz.14). The schema checks shape; the resolution rules live HERE, because
 * the DB deliberately cannot express them (ADR
 * `an-initiative-links-devices-from-the-membership-to-real-programs`):
 *  - the (initiative, partner) pair must be an ACTIVE membership;
 *  - the program must be REAL (`initiativeId: null`) — an initiative copy is workflow
 *    standing, not a device — and belong to the SAME partner as the membership.
 * A program failing either rule is rejected whole (AGENTS lesson 3). Linking an
 * already-linked program is a no-op, the same retry-safe stance as `addMembers`.
 */
export async function linkDevice(formData: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const { initiativeId, partnerId, projectId } = parseForm(initiativeLinkDeviceSchema, formData);
    const membership = await prisma.initiativePartner.findUnique({
      where: { initiativeId_partnerId: { initiativeId, partnerId } },
    });
    if (!membership || membership.status !== 'active') {
      throw new Error('Not an active member — add the partner to the initiative first');
    }
    const program = await prisma.project.findUnique({ where: { id: projectId } });
    if (!program) throw new Error('Unknown program — refresh and re-select');
    if (program.initiativeId !== null) {
      throw new Error("That is an initiative copy — link one of the partner's real device programs");
    }
    if (program.partnerId !== partnerId) {
      throw new Error("Program belongs to a different partner — link one of this member's own programs");
    }
    await prisma.initiativeDevice.upsert({
      where: { initiativePartnerId_projectId: { initiativePartnerId: membership.id, projectId } },
      create: { initiativePartnerId: membership.id, projectId },
      update: {},
    });
    revalidateInitiative(initiativeId, [partnerId]);
  });
}

/** Remove a device link. The link row id is the canonical key — the affordance sits
 *  beside the rendered link. The program itself is untouched; only the join goes. */
export async function unlinkDevice(formData: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const { deviceId } = parseForm(initiativeUnlinkDeviceSchema, formData);
    const device = await prisma.initiativeDevice.findUnique({
      where: { id: deviceId },
      include: { membership: { select: { initiativeId: true, partnerId: true } } },
    });
    if (!device) throw new Error('Not linked — nothing to unlink');
    await prisma.initiativeDevice.delete({ where: { id: deviceId } });
    revalidateInitiative(device.membership.initiativeId, [device.membership.partnerId]);
  });
}
