'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '../../lib/db';
import { indexEntity } from '../../lib/search';
import { getCurrentUser } from '../../lib/session';
import { authConfigured } from '../../auth';
import { userFromHandle } from '../../lib/auth';
import { parseForm, personCreateSchema, personDeleteSchema, personMoveSchema, personUpdateSchema } from '../../lib/schemas';
import { hasTakenEffect } from '../../lib/people';
import { createPersonAt } from '../../lib/profiles';
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
  const person = await createPersonAt({ name, email, partnerId, role: role ?? undefined });
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

  // The person's NAME is the human name ('Dylan Thomas'), not the handle — the
  // directory is read by people, and resolvePerson matches on the unique email.
  const person = await createPersonAt({ name: identity.name, email, partnerId });
  await indexEntity('person', person.id);
  redirect(`/people/${person.id}`);
}

export async function movePersonCompany(formData: FormData): Promise<ActionResult> {
  return guarded(async () => {
  const { personId, newPartnerId, newRole, startDate } = parseForm(personMoveSchema, formData);

  // Close any currently OPEN affiliations, then open the new one.
  //
  // The guard fires here and the disable is honest rather than a waiver: "open" is not
  // "current", and this action knows it. With a move already scheduled — today's period
  // closed on 1 Nov, next November's open — recording a second move closes the FUTURE
  // period and leaves today's alone, so the career gains an overlap. Closing the period
  // that COVERS the effective date is the right rule, and it belongs with the unified
  // move/correct dialog rather than bolted on here: autoknow-pvn (#127 E14).
  await prisma.personAffiliation.updateMany({
    // eslint-disable-next-line no-restricted-syntax -- known-wrong, tracked in autoknow-pvn
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

/**
 * Correct the CURRENT record: name, email, notes. A correction, not a change — the
 * value was always wrong, so there is no effective date and nothing is appended to the
 * career. Moving employer is `movePersonCompany`, which DOES take a date; #127 E14
 * unifies the two behind one dialog.
 *
 * Email is the identity key here — `Person.email` is unique and `resolvePerson` matches
 * on it — so it is the one field with reach beyond the row, and the reach is not all
 * handled: `Project.ownerName` still stores an address as FREE TEXT, so programs owned
 * under the old one keep pointing at it. Renaming an owner's address today orphans their
 * programs, until #127 E6 gives ownership a real FK.
 */
export async function updatePerson(formData: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const { personId, name, email, notes } = parseForm(personUpdateSchema, formData);

    // Name the clash rather than letting the raw constraint failure speak: `guarded`
    // would flatten a P2002 into its generic "something went wrong" line, which is no
    // help when the duplicate is a person you could go and look at.
    // Thrown with an em-dash because that is how `guarded` tells a message written for
    // a user from a raw internal one (lib/actionResult).
    const clash = await prisma.person.findUnique({ where: { email }, select: { id: true, name: true } });
    if (clash && clash.id !== personId) {
      throw new Error(`${email} already belongs to ${clash.name} — use a different address`);
    }

    await prisma.person.update({
      where: { id: personId },
      data: { name, email, notes: notes ?? null },
    });
    // The directory answers on name and address; a correction nobody can search for is
    // half a correction.
    await indexEntity('person', personId);
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
