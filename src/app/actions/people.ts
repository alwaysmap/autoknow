'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '../../lib/db';
import { indexEntity } from '../../lib/search';
import { getCurrentUser } from '../../lib/session';
import { authConfigured } from '../../auth';
import { userFromHandle } from '../../lib/auth';
import { dismissAddressSchema, myProfileSchema, parseForm, personCancelScheduleSchema, personCreateSchema, personDeleteSchema, personReviseSchema, trackPersonSchema } from '../../lib/schemas';
import { cancelScheduledPeriod, correctPersonRecord, createPersonAt, recordPersonChange } from '../../lib/profiles';
import { guarded, type ActionResult } from '../../lib/actionResult';

// Person maintenance — revise (correct or change), cancel a scheduled change, create,
// delete — zod-gated (lib/schemas). Lives here, not inline in the page, so the
// kebab-dialog client component can call them.
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

/**
 * The ONE person editor's submit (#127 E14, spec #124 §3), replacing `updatePerson`
 * (corrections) and `movePersonCompany` (moves): what the effective date SAYS is what
 * the submit DOES.
 *
 *  - EMPTY → a correction. The record was always meant to read this way: name, address
 *    and notes on the person, employer/title in place on the covering period — no
 *    period opens or closes. `correctPersonRecord` refuses an address somebody else
 *    holds today and NAMES them (`guarded` would flatten the raw failure into its
 *    generic line), and refuses an employer correction in a career gap — there is
 *    nothing to correct, which is what a date is for.
 *  - SET → a change. The covering period ends there, the next opens (`movePersonTo`,
 *    which owns the period arithmetic and, since E14, both address stamps —
 *    autoknow-wu0). Past = backdating a late recording; future = scheduling.
 *
 * #124 Class 1 on the change path: `Person.email` and the `currentPartnerId` cache both
 * mean TODAY, so both advance only once the new period covers today —
 * `coversDay(newPeriod)`, NOT `hasTakenEffect(date)`, and the two differ for a
 * BACKDATED move landing before periods already on the books: backdating Alice to 2019
 * opens a period that ENDED in 2022 — its start has certainly arrived, and she still
 * does not work there today. Name and notes are person-level, latest-wins (#124 §2), so
 * a change carries them unconditionally.
 */
export async function revisePerson(formData: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const { personId, name, email, notes, partnerId, role, effectiveDate } =
      parseForm(personReviseSchema, formData);

    if (effectiveDate == null) {
      await correctPersonRecord({ personId, name, email, notes: notes ?? null, partnerId, role });
    } else {
      // The schema pairs company with role but cannot know a DATE requires them: a
      // correction may legitimately carry neither (a person in a gap, or a name-only
      // fix), and there is nothing for a change to change to without them.
      if (partnerId == null || role == null) {
        throw new Error(
          'A dated change needs the company and role it changes to — clear the effective date to correct details in place',
        );
      }
      await recordPersonChange({
        personId, name, email, notes: notes ?? null, partnerId, role, at: effectiveDate,
      });
    }
    // The directory and the embedding answer on name, address and company; a revision
    // nobody can search for is half a revision.
    await indexEntity('person', personId);
    revalidatePath(`/people/${personId}`);
    revalidatePath('/people');
  });
}

/**
 * Cancel a SCHEDULED change from the person page's "Scheduled" line (#124 §3: a pending
 * change nobody can see — or cannot un-record — is Class 1 in a new costume). The
 * splice and the has-it-arrived refusal live in `lib/profiles` beside the arithmetic
 * they invert.
 */
export async function cancelScheduledChange(formData: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const { personId, affiliationId } = parseForm(personCancelScheduleSchema, formData);
    await cancelScheduledPeriod({ personId, affiliationId });
    revalidatePath(`/people/${personId}`);
    revalidatePath('/people');
  });
}

/**
 * Track a person named in prose (#126 / #127 E15). The affordance is a shortcut to the
 * EXISTING creation path, never a second way to write a Person: it goes through
 * `createPersonAt` like every other creator, so the address clash check, the opened
 * employment period and the search index all happen exactly once, here.
 *
 * `startDate` comes from the MENTION's own date, so a person first seen in a 2023
 * document becomes a correctly dated 2023 fact rather than a "joined today" lie. The
 * dialog prefills it and the human can change it — nothing is created without a click,
 * which is the rule ingested third-party text makes non-negotiable: a crafted document
 * must not be able to talk this app into persisting a Person on its own.
 *
 * No redirect, unlike `createPerson`: the reader is mid-sentence on a briefing and the
 * point of tracking in place is not leaving.
 */
export async function trackPerson(formData: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const { name, email, partnerId, role, startDate } = parseForm(trackPersonSchema, formData);
    const person = await createPersonAt({
      name, email, partnerId, role: role ?? undefined, startDate,
    });
    await indexEntity('person', person.id);
    revalidatePath('/people');
  });
}

/**
 * "Not a person" — silence an address everywhere, permanently (#126 decision 2).
 * Distribution lists and bots (`android-team@`, `noreply@`) recur constantly, and an
 * affordance that keeps offering to make them human is one people learn to ignore.
 *
 * Idempotent by the table's unique index: dismissing twice is the same decision, and a
 * second click while the first is in flight must not be an error the reader has to read.
 * Attributed, because a permanent app-wide suppression nobody can trace is a decision
 * nobody can revisit.
 */
export async function dismissAddress(formData: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const { address } = parseForm(dismissAddressSchema, formData);
    const me = await getCurrentUser();
    await prisma.ignoredAddress.upsert({
      where: { address },
      create: { address, dismissedBy: me.handle },
      update: {},
    });
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
