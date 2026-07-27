import 'server-only';
import { revalidatePath } from 'next/cache';
import { prisma } from './db';

// The mutation boundary for per-phase involvement (PhasePartner / PhasePerson).
//
// Involvement names three entities at once — a phase, the program that phase belongs
// to, and the partner or person joining it — and every one of them arrives as an id in
// a form body. AGENTS lesson 3: an entity reference is a picker plus a canonical key,
// and the NON-MATCH is rejected here, at the boundary, not merely hidden from the
// picker. A foreign key would also reject it, but only as an opaque constraint error
// the user can do nothing with; these resolvers fail with a sentence instead — one
// `guarded` can hand back as { error }. That matters because both editors are INLINE
// forms inside a panel: a server action that throws takes the whole surface to the
// route error boundary, and the user's half-filled input with it.
//
// Both editors of involvement (the phase editor's detail panel and the rail's About
// pane) post the same fields and refresh the same two surfaces, so the resolvers AND
// the revalidation list live here — one boundary, not one per action file.
//
// The resolvers take numbers because the SHAPE is settled upstream, by every caller: each
// parses its form through `parseForm`, whose `zId` admits only a positive integer, and any
// new caller owes the same. What is left here is the half a schema cannot do — asking the
// database whether the row exists and whether the phase really sits in the program the
// form claims. The REMOVE path is the deliberate exception: it posts a bare join-row id
// rather than a form shape, so `parseInvolvementLinkId` below is its own shape check.
//
// `requirePhaseInProject` has outgrown the module name: autoknow-9l4 gave it a third
// caller in `updatePhaseHill`, which is a phase STATUS update rather than involvement at
// all. It lives here because this is where the question "does this phase sit in that
// program" was first factored into ONE answer (d3773c1 / #219) — the JSON route had been
// asking it in its own words since 1add972 — and one answer is the point; if a fourth
// unrelated caller appears, that is the signal to move it somewhere its name covers.

/** A user-readable failure. `guarded` forwards a message only when it starts with
 *  'Invalid input' OR contains ' — ', so every sentence here carries the dash. A
 *  `function` declaration, not an arrow: only that form gives TypeScript the
 *  never-returns narrowing, so code written after a `fail(…)` is seen as dead. */
function fail(message: string): never {
  throw new Error(message);
}

// The refusal an unresolvable reference earns. Shared so the resolvers below cannot
// drift into several wordings of the same sentence — the prisma delegates themselves
// stay spelled out, because the per-model `findUnique` overloads do not unify into one
// callable type.
const noSuchRow = (noun: string) => `No such ${noun} — pick one from the list.`;

/**
 * The phase this involvement row belongs to, PROVEN to sit in the program the form
 * claims. Without the projectId half, a form could hang a partner off any phase in the
 * database and revalidate an unrelated program's page.
 */
export async function requirePhaseInProject(phaseId: number, projectId: number): Promise<void> {
  const phase = await prisma.phase.findFirst({
    where: { id: phaseId, projectId },
    select: { id: true },
  });
  if (!phase) fail('That phase is not part of this program — pick one from the list.');
}

/** The partner a PhasePartner row names, or a readable refusal. */
export async function requirePartner(partnerId: number): Promise<void> {
  const partner = await prisma.partner.findUnique({ where: { id: partnerId }, select: { id: true } });
  if (!partner) fail(noSuchRow('partner'));
}

/** The person a PhasePerson row names, or a readable refusal. */
export async function requirePerson(personId: number): Promise<void> {
  const person = await prisma.person.findUnique({ where: { id: personId }, select: { id: true } });
  if (!person) fail(noSuchRow('person'));
}

/** The join-row id a remove names. Shape only — the row itself may already be gone. */
export function parseInvolvementLinkId(raw: FormDataEntryValue | null): number {
  const id = parseInt(raw as string, 10);
  if (!Number.isInteger(id)) fail('Invalid input — that involvement reference is not a row.');
  return id;
}

/** Both surfaces that show involvement — the program page and the phase editor. */
export function revalidateInvolvement(projectId: number): void {
  revalidatePath(`/programs/${projectId}`);
  revalidatePath(`/programs/${projectId}/phases`);
}
