'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '../../lib/db';
import { indexEntity } from '../../lib/search';
import { getCurrentUser } from '../../lib/session';
import { authConfigured } from '../../auth';
import { userFromHandle } from '../../lib/auth';
import { parseForm, personCreateSchema, personDeleteSchema, personMoveSchema, personUpdateSchema } from '../../lib/schemas';
import { coversDay } from '../../lib/people';
import { addressHolderAsOf, correctPersonRecord, createPersonAt, movePersonTo } from '../../lib/profiles';
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

  // `findFirst`, not `findUnique`: `Person.email` lost `@unique` at #127 E9, because the
  // true invariant is unique AT AN INSTANT and lives on the affiliation timeline. The
  // question here is unchanged — "has this login already claimed a person?" — and one
  // answer is all a redirect can use. `email` came through `deriveEmail`, so it is
  // already in the canonical stored form this compares against.
  const existing = await prisma.person.findFirst({ where: { email } });
  if (existing) redirect(`/people/${existing.id}`);

  // The person's NAME is the human name ('Dylan Thomas'), not the handle — the
  // directory is read by people, and resolvePerson matches on the address.
  const person = await createPersonAt({ name: identity.name, email, partnerId });
  await indexEntity('person', person.id);
  redirect(`/people/${person.id}`);
}

export async function movePersonCompany(formData: FormData): Promise<ActionResult> {
  return guarded(async () => {
  const { personId, newPartnerId, newRole, startDate } = parseForm(personMoveSchema, formData);

  // The period arithmetic — which period the move date falls in, what bounds the new one
  // — lives in lib/profiles beside the resolvers that have to agree with it, and the
  // account of why "the OPEN period" was the wrong answer lives there too (autoknow-pvn).
  const newPeriod = await movePersonTo({
    personId, partnerId: newPartnerId, role: newRole, at: startDate,
  });

  // #124 Class 1. `currentPartnerId` is a CACHE of "where do they work TODAY", so it
  // may only advance once the move's date has arrived. This used to be an
  // unconditional write, which made a future-dated move apply the instant it was
  // recorded: the identity line read the new employer months early while every
  // affiliation row still said the old one, and the job actually held today was
  // filed under History. Scheduling a change must RECORD it — the affiliation rows
  // above are that record — without pretending it already happened.
  //
  // `coversDay(newPeriod)`, NOT `hasTakenEffect(startDate)`, and the two differ for a
  // BACKDATED move landing before periods already on the books: backdating Alice to 2019
  // opens a period that ENDED in 2022 — its start has certainly arrived, and she still
  // does not work there today.
  if (coversDay(newPeriod)) {
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
 * Email is the identity key here — `resolvePerson` matches on it — so it is the one
 * field with reach beyond the row, and the reach is not all handled: `Project.ownerName`
 * still stores an address as FREE TEXT, so programs owned under the old one keep
 * pointing at it. #127 E6 has added `Project.ownerPersonId` alongside it and every write
 * path now fills both, but the READERS still match on the text — so renaming an owner's
 * address still hides their programs until E7 moves those lookups onto the FK.
 *
 * The correction reaches the EMPLOYMENT PERIOD too since #127 E9: an address is a
 * property of the job, so correcting "their address" and leaving the period they are in
 * saying the old one would leave the two halves disagreeing about today. `lib/profiles`
 * does both in one transaction and picks the period with the same as-of predicate the
 * resolvers read with.
 */
export async function updatePerson(formData: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const { personId, name, email, notes } = parseForm(personUpdateSchema, formData);

    // Name the clash rather than letting the raw constraint failure speak: `guarded`
    // would flatten it into its generic "something went wrong" line, which is no help
    // when the duplicate is a person you could go and look at. Since #127 E9 the
    // question is temporal — who holds this address TODAY — because `Person.email` is no
    // longer unique and an address someone LEFT is legitimately recorded against them.
    // Thrown with an em-dash because that is how `guarded` tells a message written for
    // a user from a raw internal one (lib/actionResult).
    // ONE `at` for the check and the write. Each defaults to `new Date()` on its own, and
    // two reads of the clock either side of a period boundary is the kind of bug that
    // reproduces once a year at midnight.
    const at = new Date();
    const clash = await addressHolderAsOf(email, { exceptPersonId: personId, at });
    if (clash) {
      throw new Error(
        `${email} already belongs to ${clash.name} — correct their record first, or use a different address`,
      );
    }

    await correctPersonRecord({ personId, name, email, notes: notes ?? null, at });
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
  // Detach, don't cascade: an action item and a program outlive the person row, and
  // the text column (`assignedTo` / `ownerName`) keeps saying who it used to be.
  await prisma.actionItem.updateMany({
    where: { assignedToPersonId: personId },
    data: { assignedToPersonId: null },
  });
  await prisma.project.updateMany({
    where: { ownerPersonId: personId },
    data: { ownerPersonId: null },
  });
  await prisma.person.delete({ where: { id: personId } });

  redirect('/people');
  });
}
