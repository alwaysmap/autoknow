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
} from '../../lib/schemas';
import { guarded, type ActionResult } from '../../lib/actionResult';
import { getCurrentUser } from '../../lib/session';
import { parseSopInput } from '../../lib/sop';
import { NO_OWNER } from '../../lib/owner';
import { getTemplateWithPhases, cloneTemplateGraph, type NameSeries } from '../../lib/programTemplates';
import { createProgramFromTemplate } from '../../lib/createProgramFromTemplate';

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
    revalidateInitiative(initiative.id);
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
 * Add 1+ partners: per partner, upsert the join row to active and instantiate a fresh
 * copy of the snapshot. A partner that is already an active member is skipped — the
 * filters that FIND partners never mutate membership, so a batch may legitimately
 * include existing members and must not double-instantiate (gh-286 decision 2).
 */
export async function addPartners(formData: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const fields = parseForm(initiativeAddPartnersSchema, formData);
    const initiative = await prisma.initiative.findUnique({ where: { id: fields.initiativeId } });
    if (!initiative) throw new Error('Unknown initiative — it may have been deleted');
    if (initiative.isArchived) throw new Error('Initiative is archived — unarchive it to change membership');

    // Reject the whole batch when any id names nobody (AGENTS lesson 3) — a partial
    // apply would leave the caller guessing which of their picks stuck.
    const partners = await prisma.partner.findMany({ where: { id: { in: fields.partnerIds } } });
    const found = new Set(partners.map((p) => p.id));
    const missing = fields.partnerIds.filter((id) => !found.has(id));
    if (missing.length > 0) throw new Error(`Unknown partner id(s) — refresh and re-select: ${missing.join(', ')}`);

    const createdBy = (await getCurrentUser()).handle;
    const effectiveDate = parseSopInput(fields.targetMonth ?? '') ?? initiative.targetDate;

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
    revalidateInitiative(initiativeId, [partnerId]);
  });
}
