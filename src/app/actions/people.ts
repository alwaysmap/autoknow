'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '../../lib/db';
import { indexEntity } from '../../lib/search';
import { getCurrentUser } from '../../lib/session';
import { authConfigured } from '../../auth';
import { userFromHandle } from '../../lib/auth';
import { myProfileSchema, parseForm, personCreateSchema, personDeleteSchema, personMoveSchema, personUpdateSchema } from '../../lib/schemas';
import { coversDay } from '../../lib/people';
import { correctPersonRecord, createPersonAt, movePersonTo } from '../../lib/profiles';
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
 *  from the session, never the form); the caller only picks the organization. So
 *  `myProfileSchema` covers the form half and nothing more — its docblock in lib/schemas
 *  argues why that asymmetry with `createPerson`'s schema is deliberate. */
export async function createMyProfile(formData: FormData) {
  const { partnerId, user: override } = parseForm(myProfileSchema, formData);
  const current = await getCurrentUser();
  // With real auth, the SESSION is the identity — the form can't spoof it. The
  // ?user= override only exists in stub mode (no auth configured: dev, e2e).
  const identity = !authConfigured && override ? userFromHandle(override) : current;
  const email = identity.email;

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
 * Email used to be the identity key with reach BEYOND the row: `Project.ownerName`
 * stores an address as free text, so correcting somebody's address hid every program
 * owned under the old one. That is closed — E6 added `Project.ownerPersonId` and made
 * every write path fill both, and E7 moved every READER onto the FK. Correcting an
 * address is now a change to one row, and the programs follow the person.
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

    // `correctPersonRecord` refuses an address somebody else holds today, and NAMES them:
    // `guarded` would otherwise flatten the raw constraint failure into its generic
    // "something went wrong" line, which is no help when the duplicate is a person you
    // could go and look at. Since #127 E9 that question is temporal — who holds this
    // address TODAY — because `Person.email` is no longer unique and an address someone
    // LEFT is legitimately recorded against them.
    await correctPersonRecord({ personId, name, email, notes: notes ?? null });
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
  // Detach, don't cascade: an action item and a program outlive the person row. The
  // text column (`assignedTo` / `ownerName`) keeps saying who it used to be, which is
  // an AUDIT trail now rather than a display fallback — since #127 E7 the surfaces read
  // the FK, so a program whose owner was deleted reads as unowned and prompts for a new
  // one. That is the intended reading: the human is gone, the program still needs a TEL.
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
