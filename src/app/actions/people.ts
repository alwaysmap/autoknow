'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '../../lib/db';
import { indexEntity } from '../../lib/search';
import { getCurrentUser } from '../../lib/session';
import { authConfigured } from '../../auth';
import { deriveEmail } from '../../lib/auth';
import { parseForm, personCopySchema, personCreateSchema, personDeleteSchema, personMoveSchema } from '../../lib/schemas';

// Person maintenance (move / copy / delete), zod-gated (lib/schemas). Lives here —
// not inline in the page — so the kebab-dialog client component can call them.

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
  const display = !authConfigured && override ? override : current.display;
  const email = deriveEmail(display);
  const partnerId = parseInt((formData.get('partnerId') as string) || '', 10);
  if (Number.isNaN(partnerId) || partnerId <= 0) throw new Error('Pick an organization');

  const existing = await prisma.person.findUnique({ where: { email } });
  if (existing) redirect(`/people/${existing.id}`);

  const person = await prisma.person.create({
    data: { name: display.replace(/^@/, ''), email, currentPartnerId: partnerId },
  });
  await prisma.personAffiliation.create({
    data: { personId: person.id, partnerId, role: 'Member', startDate: new Date() },
  });
  await indexEntity('person', person.id);
  redirect(`/people/${person.id}`);
}

export async function movePersonCompany(formData: FormData) {
  const { personId, newPartnerId, newRole, startDate } = parseForm(personMoveSchema, formData);

  // Close any currently active affiliations, then open the new one.
  await prisma.personAffiliation.updateMany({
    where: { personId, endDate: null },
    data: { endDate: startDate },
  });
  await prisma.personAffiliation.create({
    data: { personId, partnerId: newPartnerId, role: newRole, startDate },
  });
  await prisma.person.update({
    where: { id: personId },
    data: { currentPartnerId: newPartnerId },
  });
  await indexEntity('person', personId); // the embedding text names the company

  revalidatePath(`/people/${personId}`);
  revalidatePath('/people');
}

export async function copyPerson(formData: FormData) {
  const { personId, copyEmail } = parseForm(personCopySchema, formData);

  const source = await prisma.person.findUnique({ where: { id: personId } });
  if (!source) throw new Error('Person not found');

  const copy = await prisma.person.create({
    data: {
      name: source.name,
      email: copyEmail,
      currentPartnerId: source.currentPartnerId,
      notes: source.notes,
    },
  });
  await indexEntity('person', copy.id);

  // Duplicate the active affiliation, if any.
  const activeAff = await prisma.personAffiliation.findFirst({
    where: { personId, endDate: null },
  });
  if (activeAff) {
    await prisma.personAffiliation.create({
      data: { personId: copy.id, partnerId: activeAff.partnerId, role: activeAff.role, startDate: new Date() },
    });
  }

  redirect(`/people/${copy.id}`);
}

export async function deletePerson(formData: FormData) {
  const { personId } = parseForm(personDeleteSchema, formData);

  await prisma.personAffiliation.deleteMany({ where: { personId } });
  await prisma.phasePerson.deleteMany({ where: { personId } });
  await prisma.actionItem.updateMany({
    where: { assignedToPersonId: personId },
    data: { assignedToPersonId: null },
  });
  await prisma.person.delete({ where: { id: personId } });

  redirect('/people');
}
