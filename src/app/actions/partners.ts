'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '../../lib/db';
import { indexEntity } from '../../lib/search';
import { parseForm, partnerFieldsSchema } from '../../lib/schemas';
import { guarded, type ActionResult } from '../../lib/actionResult';

// Partner CRUD. Partners used to be ingest/seed-only; these actions make the record
// fully editable in the UI. Delete is deliberately conservative: a partner that still
// owns programs or is someone's current employer cannot be deleted — reassign first.
// (Person.currentPartnerId is a required FK, and silently cascading programs away
// would destroy the portfolio history.)

// Zod is the single gate (lib/schemas): trims, coerces ids, requires region,
// validates URLs — malformed input throws before Prisma ever sees it.
function readFields(formData: FormData) {
  return parseForm(partnerFieldsSchema, formData);
}

export async function createPartner(formData: FormData): Promise<ActionResult> {
  return guarded(async () => {
  const fields = readFields(formData);
  const partner = await prisma.partner.create({ data: fields });
  await indexEntity('partner', partner.id);
  revalidatePath('/partners');
  redirect(`/partners/${partner.id}`);
  });
}

export async function updatePartner(formData: FormData): Promise<ActionResult> {
  return guarded(async () => {
  const partnerId = parseInt((formData.get('partnerId') as string) || '', 10);
  if (Number.isNaN(partnerId)) throw new Error('Invalid partner ID');
  const fields = readFields(formData);
  await prisma.partner.update({ where: { id: partnerId }, data: fields });
  await indexEntity('partner', partnerId);
  revalidatePath(`/partners/${partnerId}`);
  revalidatePath('/partners');
  });
}

export async function deletePartner(formData: FormData): Promise<ActionResult> {
  return guarded(async () => {
  const partnerId = parseInt((formData.get('partnerId') as string) || '', 10);
  if (Number.isNaN(partnerId)) throw new Error('Invalid partner ID');

  // This one counts off the CACHE on purpose, and it is the only place that should.
  // The question here is not "who works here today" — it is "what would this DELETE
  // break", and what it would break is the required `Person.currentPartnerId` FK. Asking
  // as-of would let the delete through for a person whose cache still points here and
  // whose affiliation has moved on, and Postgres would then refuse the transaction with
  // a constraint violation the user cannot act on. Referential integrity is answered by
  // the reference.
  const [programCount, employeeCount] = await Promise.all([
    prisma.project.count({ where: { partnerId } }),
    // eslint-disable-next-line no-restricted-syntax -- FK integrity, not display; see above
    prisma.person.count({ where: { currentPartnerId: partnerId } }),
  ]);
  if (programCount > 0) throw new Error(`Partner still owns ${programCount} program(s) — reassign or delete them first`);
  if (employeeCount > 0) throw new Error(`Partner is still the current employer of ${employeeCount} person(s) — reassign them first`);

  // Atomic: relationship history, affiliations, context, phase involvements, lead
  // links, and cached summaries all go with the record.
  await prisma.$transaction([
    prisma.partnerState.deleteMany({ where: { partnerId } }),
    prisma.personAffiliation.deleteMany({ where: { partnerId } }),
    prisma.contextRevision.deleteMany({ where: { contextUrl: { partnerId } } }),
    prisma.contextUrl.deleteMany({ where: { partnerId } }),
    prisma.phasePartner.deleteMany({ where: { partnerId } }),
    prisma.phase.updateMany({ where: { leadPartnerId: partnerId }, data: { leadPartnerId: null } }),
    prisma.summary.deleteMany({ where: { scope: 'partner', targetId: partnerId } }),
    prisma.partner.delete({ where: { id: partnerId } }),
  ]);

  revalidatePath('/partners');
  redirect('/partners');
  });
}
