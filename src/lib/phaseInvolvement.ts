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
// the user can do nothing with; these resolvers fail with a sentence instead.
//
// Both editors of involvement (the phase editor's detail panel and the rail's About
// pane) post the same fields and refresh the same two surfaces, so the resolvers AND
// the revalidation list live here — one boundary, not one per action file.

/** A user-readable failure. `guarded` only forwards messages containing ' — '. A
 *  `function` declaration, not an arrow: only that form gives TypeScript the
 *  never-returns narrowing, so code written after a `fail(…)` is seen as dead. */
function fail(message: string): never {
  throw new Error(message);
}

// The two refusals a bad reference can earn. Shared so the resolvers below cannot
// drift into several wordings of the same sentence — the prisma delegates themselves
// stay spelled out, because the per-model `findUnique` overloads do not unify into one
// callable type.
const notAReference = (noun: string) => `Invalid input — that ${noun} reference is not a ${noun}.`;
const noSuchRow = (noun: string) => `No such ${noun} — pick one from the list.`;

/**
 * The phase this involvement row belongs to, PROVEN to sit in the program the form
 * claims. Without the projectId half, a form could hang a partner off any phase in the
 * database and revalidate an unrelated program's page.
 */
export async function requirePhaseInProject(phaseId: number, projectId: number): Promise<void> {
  // Separate guards, separate sentences: a single "that phase reference" message for
  // both halves sends whoever is debugging to the wrong form field.
  if (!Number.isInteger(phaseId)) fail(notAReference('phase'));
  if (!Number.isInteger(projectId)) fail(notAReference('program'));
  const phase = await prisma.phase.findFirst({
    where: { id: phaseId, projectId },
    select: { id: true },
  });
  if (!phase) fail('That phase is not part of this program — pick one from the list.');
}

/** The partner a PhasePartner row names, or a readable refusal. */
export async function requirePartner(partnerId: number): Promise<void> {
  if (!Number.isInteger(partnerId)) fail(notAReference('partner'));
  const partner = await prisma.partner.findUnique({ where: { id: partnerId }, select: { id: true } });
  if (!partner) fail(noSuchRow('partner'));
}

/** The person a PhasePerson row names, or a readable refusal. */
export async function requirePerson(personId: number): Promise<void> {
  if (!Number.isInteger(personId)) fail(notAReference('person'));
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
