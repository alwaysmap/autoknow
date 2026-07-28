import { prisma } from './db';
import { personDirectorySelect, resolvePerson } from './people';

/**
 * The two owner columns on `Project`, shaped so they can be spread straight into a
 * Prisma `data:` — which is the point. Ownership is stored twice: `ownerPersonId` is the
 * reference EVERY reader now goes through (#127 E7), and `ownerName` is the canonical
 * email kept beside it as legacy text — no longer read for display, still written, and
 * still the column the backfill and remediation arms reason about. The dual-write
 * continues because E7 was the read-side contract step, not the column drop — and the
 * drop is not pending: bead autoknow-p78 asked whether to retire `ownerName` and the
 * answer was KEEP, argued at the column in prisma/schema.prisma. If that is ever
 * reversed it is a separate expand→backfill→contract merge (AGENTS.md).
 * Handing back the PAIR is what makes the dual-write structural rather than remembered —
 * there is no seam here that yields an email alone, so no mutation path can write one
 * column and forget the other.
 */
export interface OwnerFields {
  ownerName: string;
  ownerPersonId: number;
}

/** No owner: the same pair, both sides cleared, for the one path where owner is optional. */
export const NO_OWNER: { ownerName: null; ownerPersonId: null } = {
  ownerName: null,
  ownerPersonId: null,
};

/** Owner or no owner — the type a caller holds while it is still deciding. Exported so
 *  the nullable case has ONE spelling too; an inline annotation at a call site is a
 *  third description of the pair, free to drift from the two above. */
export type OwnerFieldsOrNone = OwnerFields | typeof NO_OWNER;

/**
 * A program's Googler owner must be an EXISTING Person — the form pickers only
 * offer existing people, and this is the server-side seam that keeps hand-crafted
 * submissions from landing freeform text in Project.ownerName (and, since #127 E7,
 * from landing a program with no `ownerPersonId` — which is now the same thing as a
 * program with no owner at all). Accepts the same
 * shapes resolvePerson does ('jdoe@google.com', '@jdoe', 'jdoe', a full name) and
 * returns the person's canonical email plus their id.
 */
export async function requireOwner(input: string): Promise<OwnerFields> {
  const people = await prisma.person.findMany({ select: personDirectorySelect });
  const person = resolvePerson(people, input);
  if (!person) throw new Error(`Owner must be an existing person — no match for “${input}”`);
  return { ownerName: person.email, ownerPersonId: person.id };
}
