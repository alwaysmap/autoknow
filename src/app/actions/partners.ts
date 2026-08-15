'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '../../lib/db';
import { indexEntity } from '../../lib/search';
import { parseForm, partnerDeleteSchema, partnerFieldsSchema, partnerUpdateSchema } from '../../lib/schemas';
import { guarded, type ActionResult } from '../../lib/actionResult';
import { getPartnerDeleteBlockers, partnerDeleteRefusal } from '../../lib/partnerDeletion';

// Partner CRUD. Partners used to be ingest/seed-only; these actions make the record
// fully editable in the UI. Delete is deliberately conservative: a partner that still
// owns programs or is someone's current employer cannot be deleted — reassign first.
// (Person.currentPartnerId is a required FK, and silently cascading programs away
// would destroy the portfolio history.)
//
// Zod is the single gate (lib/schemas): trims, coerces ids, requires region, validates
// URLs — malformed input throws before Prisma ever sees it. Three schemas for the three
// shapes: the editable fields, those fields plus the id they belong to, and the id alone.
// That mirrors the person actions, whose `personDeleteSchema` exists for exactly the same
// one-id job (autoknow-9l4).

export async function createPartner(formData: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const fields = parseForm(partnerFieldsSchema, formData);
    const partner = await prisma.partner.create({ data: fields });
    await indexEntity('partner', partner.id);
    revalidatePath('/partners');
    redirect(`/partners/${partner.id}`);
  });
}

export async function updatePartner(formData: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const { partnerId, ...fields } = parseForm(partnerUpdateSchema, formData);
    await prisma.partner.update({ where: { id: partnerId }, data: fields });
    await indexEntity('partner', partnerId);
    revalidatePath(`/partners/${partnerId}`);
    revalidatePath('/partners');
  });
}

export async function deletePartner(formData: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const { partnerId } = parseForm(partnerDeleteSchema, formData);

    // The preconditions are counted in ONE place — `lib/partnerDeletion` — because the
    // confirmation dialog pre-flights them, and a dialog that counts differently from the
    // guard offers deletes the guard then refuses (`autoknow-aa7`). That module also carries
    // the reasoning for counting the `currentPartnerId` FK here rather than the as-of roster.
    const refusal = partnerDeleteRefusal(await getPartnerDeleteBlockers(partnerId));
    if (refusal) throw new Error(refusal);

    // Atomic: relationship history, affiliations, context, phase involvements, lead
    // links, and cached summaries all go with the record.
    await prisma.$transaction([
      prisma.partnerState.deleteMany({ where: { partnerId } }),
      prisma.personAffiliation.deleteMany({ where: { partnerId } }),
      prisma.contextRevision.deleteMany({ where: { contextUrl: { partnerId } } }),
      prisma.contextUrl.deleteMany({ where: { partnerId } }),
      prisma.phasePartner.deleteMany({ where: { partnerId } }),
      prisma.phase.updateMany({ where: { leadPartnerId: partnerId }, data: { leadPartnerId: null } }),
      // Escalations that name this partner AND a program keep the program and lose the
      // partner attribution. The FK is SET NULL and would do this unasked; the line is
      // here so the choice is on the page, exactly as `leadPartnerId` above is. The
      // partner-ONLY ones never reach this transaction — they are a delete blocker
      // (`lib/partnerDeletion`), because for them the same SET NULL produces a row that
      // belongs to nothing (autoknow-40f).
      prisma.escalation.updateMany({ where: { partnerId }, data: { partnerId: null } }),
      prisma.summary.deleteMany({ where: { scope: 'partner', targetId: partnerId } }),
      prisma.partner.delete({ where: { id: partnerId } }),
    ]);

    revalidatePath('/partners');
    redirect('/partners');
  });
}
