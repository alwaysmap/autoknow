import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from './db';

// AS-OF RESOLVERS (#127 E5, spec #124 §4). "Which company is this person at, and as
// what" is a question about a DAY. Why `where: { endDate: null }` is the wrong way to
// ask it is written once, at `coversDay` in ./people, and why `Person.currentPartnerId`
// is the other wrong way is written once in ADR
// currentpartnerid-is-a-cache-affiliations-are-the-truth. This module does not repeat
// either: in short, both coincide with the truth only while nobody has a move recorded.
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
 * successor starting that day does. A contiguous career therefore matches exactly ONE
 * period per person — but that is the shape the data is MEANT to have, not something
 * this predicate enforces: there is no exclusion constraint, and `movePersonCompany`
 * can still author an overlap (autoknow-pvn). The resolvers below order deterministically
 * so an overlap picks the same row on every render rather than flickering.
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

/** An affiliation with the partner it is at, and the partner's classification —
 *  /programs/:id colours a phase participant by whether their company is an OEM or a
 *  supplier, which is the same question as "which company", one level up. */
const withPartner = { include: { partner: { include: { type: true } } } } as const;

/**
 * The one affiliation `personId` held on `at`, or null if they held none (hired later,
 * or a gap). Null is a real answer, not a missing row: the old `currentPartnerId` cache
 * would happily name a company on a day the person did not work there.
 *
 * /people/:id is the caller. It holds the whole career anyway, so `coversDay` in JS
 * would work — the reason to come here instead is that this is the SAME spelling of the
 * predicate every other surface uses, in SQL, rather than a second rendering of it that
 * can drift. Either way the page must decide once and define History as the complement
 * of the answer; asking here is what lets E10 change the day by passing one argument.
 */
export async function profileAsOf(personId: number, at: Date = new Date()) {
  return prisma.personAffiliation.findFirst({
    where: { personId, ...asOfWhere(at) },
    // Newest start first, so an overlapping pair (see `asOfWhere`) resolves to the same
    // row on every render. `findFirst` without an order is whatever the plan returns.
    orderBy: { startDate: 'desc' },
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
    // Ascending, so the last write into the Map below is the newest start — the same row
    // `profileAsOf` picks for the same person. The two must not disagree.
    orderBy: { startDate: 'asc' },
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

/** One row of a roster, reduced to what a LIST needs — a person, not an affiliation. */
export interface RosterMember {
  id: number;
  name: string;
  email: string;
}

/**
 * `partnerRosterAsOf` for every partner in ONE query, keyed by partnerId — the /partners
 * list renders a team cell per row and must not issue a query per partner.
 *
 * Selects the person rather than including the affiliation, because a list has no use
 * for the period: `getAllPartners` previously merged the `currentEmployees` back-relation
 * with EVERY affiliation the partner ever had, so the team cell listed leavers forever
 * and the "My partners" toggle matched a company you left in 2022.
 *
 * A partner with nobody there today is absent from the map, not an empty array — same
 * contract as `profilesAsOf`, so callers default rather than distinguishing two empties.
 */
export async function partnerRostersAsOf(at: Date = new Date()) {
  const rows = await prisma.personAffiliation.findMany({
    where: asOfWhere(at),
    select: { partnerId: true, person: { select: { id: true, name: true, email: true } } },
    orderBy: { person: { name: 'asc' } },
  });
  const byPartner = new Map<number, RosterMember[]>();
  for (const r of rows) {
    const list = byPartner.get(r.partnerId) ?? [];
    list.push(r.person);
    byPartner.set(r.partnerId, list);
  }
  return byPartner;
}

/**
 * Create a person AND the affiliation period that says where they start. The only
 * sanctioned way to add a person, because after #127 E5 a Person without an affiliation
 * has no employer that any DISPLAY path will find — the `currentPartnerId` column is
 * written here too, but only `deletePartner` reads it, and only to ask whether a delete
 * would break the FK.
 *
 * It exists because there were TWO creation paths and only one of them opened a period:
 * the `createPerson` server action did, `POST /api/people` did not. That difference was
 * invisible while the cache was the display source, and became "the seeded directory
 * shows no company for half its people" the moment it stopped being. One function, so
 * the two cannot drift again (AGENTS lesson 7).
 *
 * ONE nested write, not two statements: the whole point is that the person and the
 * period arrive together, so a failure between them must not be able to leave behind
 * exactly the orphan this function exists to prevent. Prisma runs a nested create in a
 * transaction.
 *
 * `startDate` defaults to now — a person added today started today. Laying down the rest
 * of a career is what the affiliations endpoint is for.
 */
export async function createPersonAt(person: {
  name: string;
  email: string;
  notes?: string | null;
  partnerId: number;
  role?: string;
  startDate?: Date;
}) {
  const { name, email, notes, partnerId, role = 'Member', startDate = new Date() } = person;
  return prisma.person.create({
    data: {
      name,
      email,
      notes: notes ?? null,
      // eslint-disable-next-line no-restricted-syntax -- writes the cache; this IS its maintainer
      currentPartnerId: partnerId,
      affiliations: { create: { partnerId, role, startDate } },
    },
  });
}

/**
 * The as-of predicate as raw SQL, for the ONE query that cannot be a Prisma call:
 * `lib/search`'s UNION, which is hand-written `Prisma.sql` end to end.
 *
 * It exists so that query does not spell the rule a fourth time. `asOfWhere` above is
 * the Prisma spelling and this is the SQL one; they are two renderings of a single
 * sentence and must be changed together — which is why they live four lines apart
 * rather than in the module that needs each.
 *
 * Correlates on a subquery rather than a join so the caller can drop it into an existing
 * `WHERE` without touching its FROM clause, and so a person cannot appear twice.
 */
export function personIsAtPartnerAsOfSql(
  personIdColumn: Prisma.Sql,
  partnerId: number,
  at: Date = new Date(),
) {
  return Prisma.sql`${personIdColumn} IN (
    SELECT a."personId" FROM "PersonAffiliation" a
    WHERE a."partnerId" = ${partnerId}
      AND a."startDate" <= ${at}
      AND (a."endDate" IS NULL OR a."endDate" > ${at}))`;
}
