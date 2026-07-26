'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '../../lib/db';
import { indexEntity } from '../../lib/search';
import { getCurrentUser } from '../../lib/session';
import { authConfigured } from '../../auth';
import { userFromHandle } from '../../lib/auth';
import { parseForm, personCreateSchema, personDeleteSchema, personMoveSchema } from '../../lib/schemas';
import { hasTakenEffect } from '../../lib/people';
import { guarded, type ActionResult } from '../../lib/actionResult';

// Person maintenance (move / delete), zod-gated (lib/schemas). Lives here —
// not inline in the page — so the kebab-dialog client component can call them.
//
// There is deliberately NO copy action. It forked one human into a second Person
// row (#124 Class 3): every `personId` FK stayed stranded on the original, the
// history split, and both rows then competed in resolvePerson. Its only honest
// use — "these are two different humans" — is what createPerson is for.

export async function createPerson(formData: FormData) {
  const { name, email, partnerId, role } = parseForm(personCreateSchema, formData);
  const person = await prisma.person.create({
    data: { name, email, currentPartnerId: partnerId },
  });
  await prisma.personAffiliation.create({
    data: { personId: person.id, partnerId, role: role ?? 'Member', startDate: new Date() },
  });
  await indexEntity('person', person.id);
  redirect(`/people/${person.id}`);
}

/** Self-provisioning from /me: the LOGIN is the identity source (name/email come
 *  from the session, never the form); the caller only picks the organization. */
export async function createMyProfile(formData: FormData) {
  const current = await getCurrentUser();
  // With real auth, the SESSION is the identity — the form can't spoof it. The
  // ?user= override only exists in stub mode (no auth configured: dev, e2e).
  const override = ((formData.get('user') as string) || '').trim();
  const identity = !authConfigured && override ? userFromHandle(override) : current;
  const email = identity.email;
  const partnerId = parseInt((formData.get('partnerId') as string) || '', 10);
  if (Number.isNaN(partnerId) || partnerId <= 0) throw new Error('Pick an organization');

  const existing = await prisma.person.findUnique({ where: { email } });
  if (existing) redirect(`/people/${existing.id}`);

  const person = await prisma.person.create({
    // The person's NAME is the human name ('Dylan Thomas'), not the handle — the
    // directory is read by people, and resolvePerson matches on the unique email.
    data: { name: identity.name, email, currentPartnerId: partnerId },
  });
  await prisma.personAffiliation.create({
    data: { personId: person.id, partnerId, role: 'Member', startDate: new Date() },
  });
  await indexEntity('person', person.id);
  redirect(`/people/${person.id}`);
}

export async function movePersonCompany(formData: FormData): Promise<ActionResult> {
  return guarded(async () => {
  const { personId, newPartnerId, newRole, startDate } = parseForm(personMoveSchema, formData);

  // Close any currently active affiliations, then open the new one.
  await prisma.personAffiliation.updateMany({
    where: { personId, endDate: null },
    data: { endDate: startDate },
  });
  await prisma.personAffiliation.create({
    data: { personId, partnerId: newPartnerId, role: newRole, startDate },
  });

  // #124 Class 1. `currentPartnerId` is a CACHE of "where do they work TODAY", so it
  // may only advance once the move's date has arrived. This used to be an
  // unconditional write, which made a future-dated move apply the instant it was
  // recorded: the identity line read the new employer months early while every
  // affiliation row still said the old one, and the job actually held today was
  // filed under History. Scheduling a change must RECORD it — the affiliation rows
  // above are that record — without pretending it already happened.
  //
  // A backdated move still lands here, correctly: its date has arrived, so the
  // cache advances and the window is retroactively re-attributed.
  if (hasTakenEffect(startDate)) {
    await prisma.person.update({
      where: { id: personId },
      data: { currentPartnerId: newPartnerId },
    });
  }
  await indexEntity('person', personId); // the embedding text names the company

  revalidatePath(`/people/${personId}`);
  revalidatePath('/people');
  });
}

export async function deletePerson(formData: FormData): Promise<ActionResult> {
  return guarded(async () => {
  const { personId } = parseForm(personDeleteSchema, formData);

  await prisma.personAffiliation.deleteMany({ where: { personId } });
  await prisma.phasePerson.deleteMany({ where: { personId } });
  await prisma.actionItem.updateMany({
    where: { assignedToPersonId: personId },
    data: { assignedToPersonId: null },
  });
  await prisma.person.delete({ where: { id: personId } });

  redirect('/people');
  });
}
