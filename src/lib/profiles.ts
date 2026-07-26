import 'server-only';
import { prisma } from './db';

// AS-OF RESOLVERS (#127 E5, spec #124 §4). "Which company is this person at, and as
// what" is a question about a DAY. Why `where: { endDate: null }` is the wrong way to
// ask it is written once, at `coversDay` in ./people — that is the canonical account
// and this module does not repeat it. In short: the two questions coincide only while
// nobody has a move recorded.
//
// `coversDay` is the JS twin, for a period already in hand. These are for periods still
// in the database: the predicate goes into SQL so the wrong row never comes back to be
// filtered, which is what E4's composite indexes were added for.
//
// "Profile" is #124 §4's word for a person's affiliation as of a date — not the
// account-shaped sense in `createMyProfile`.
//
// NOT in ./people because that module is imported by client components
// (ProgramsClient, UserMenu, ProjectMetaHeader) and these reach for prisma.

/**
 * The as-of predicate as a Prisma `where` fragment: `startDate <= at AND (endDate IS
 * NULL OR endDate > at)`. Half-open — a period ENDING on `at` does not cover it, its
 * successor starting that day does — so exactly one period matches per person.
 *
 * Shaped for `@@index([personId, startDate, endDate])`: `startDate` is the index BOUND
 * and lands in Index Cond. `endDate` is NOT and cannot be — `IS NULL OR >` is not an
 * indexable boundary — so it rides along as a Filter, evaluated without a heap fetch
 * while the select list stays inside the index. The schema records that EXPLAIN; keep
 * this spelling aligned with it rather than inventing a variant it does not cover.
 */
const asOfWhere = (at: Date) => ({
  startDate: { lte: at },
  OR: [{ endDate: null }, { endDate: { gt: at } }],
});

/** An affiliation with the partner it is at. Narrow this to a `select` if a caller
 *  ever wants only a field or two — today the roster renders the partner. */
const withPartner = { include: { partner: true } } as const;

/**
 * The one affiliation `personId` held on `at`, or null if they held none (hired later,
 * or a gap). Null is a real answer, not a missing row: `Person.currentPartnerId` will
 * happily name a company on a day the person did not work there.
 *
 * NO production caller yet — staged, not dead. /people/:id answers the same question in
 * JS today via `coversDay`, because it already has the affiliations in hand; it moves
 * here when E10 gives that page a reason to ask about a day other than today.
 */
export async function profileAsOf(personId: number, at: Date = new Date()) {
  return prisma.personAffiliation.findFirst({
    where: { personId, ...asOfWhere(at) },
    ...withPartner,
  });
}

/**
 * `profileAsOf` for many people in ONE query, keyed by personId — a list rendering a
 * Role column must not issue a query per row. Absent from the map means the same as
 * null above: callers render nothing rather than guessing.
 */
export async function profilesAsOf(personIds: number[], at: Date = new Date()) {
  if (personIds.length === 0) return new Map<number, Awaited<ReturnType<typeof profileAsOf>>>();
  const rows = await prisma.personAffiliation.findMany({
    where: { personId: { in: personIds }, ...asOfWhere(at) },
    ...withPartner,
  });
  return new Map(rows.map((r) => [r.personId, r]));
}

/**
 * Everyone at `partnerId` on `at`, with the person — the roster. Ordered by name so the
 * caller does not re-sort; a roster is read as a list of people, not of affiliations.
 *
 * The old form was wrong in BOTH directions, which is why the test asserts both: it
 * listed a person on the partner they move to NEXT, and omitted them from the one they
 * are at today.
 */
export async function partnerRosterAsOf(partnerId: number, at: Date = new Date()) {
  return prisma.personAffiliation.findMany({
    where: { partnerId, ...asOfWhere(at) },
    include: { person: true },
    orderBy: { person: { name: 'asc' } },
  });
}
