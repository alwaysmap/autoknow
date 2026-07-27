import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from './db';

// EMPLOYMENT PERIODS: the as-of resolvers, and the two writes that open one (#127 E5,
// autoknow-pvn, spec #124 §4). "Which company is this person at, and as what" is a
// question about a DAY, and the two wrong ways to ask it — `where: { endDate: null }`
// and the `Person.currentPartnerId` cache — are argued once each, at `coversDay` in
// ./people and in ADR currentpartnerid-is-a-cache-affiliations-are-the-truth. Both
// coincide with the truth only while nobody has a move recorded.
//
// `createPersonAt` and `movePersonTo` are WRITES, which "resolvers" does not suggest.
// They are here because opening a period is a decision about the day the resolvers
// resolve — `movePersonTo` picks the period to close with the very same predicate, which
// is the whole of autoknow-pvn — and because they need prisma, which rules out ./people.
//
// `coversDay` is the JS twin, for a period already in hand. These are for periods still
// in the database: the predicate goes into SQL so the wrong row never comes back to be
// filtered, which is what E4's composite indexes were added for. #127 E5 left `coversDay`
// with no production caller — /people/:id was the last and now asks in SQL — and
// autoknow-pvn plus #127 E10 gave it two: `movePersonCompany` holds the period it just
// wrote, and `labelWithJobHeldThen` (lib/activity) holds a whole CAREER and resolves a
// page of feed rows against it, where asking here would be a round trip per row. That is
// the division. Writing a third date comparison instead of either is the bug.
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
 * this predicate enforces: there is no exclusion constraint, and the affiliations API
 * can still author an overlap (autoknow-2of). The resolvers below order deterministically
 * so an overlap picks the same row on every render rather than flickering.
 * `movePersonTo` used to be the other author of one; since autoknow-pvn it HEALS an
 * overlap it finds, because it closes every period covering the move date.
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
 * of the answer. `at` is what lets any surface ask about a day other than today — the
 * page's own Activity feed asks about many, but through `coversDay`, because it holds
 * the career and a query per row is the thing that division exists to avoid.
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
 * `partnerRosterAsOf` for every partner in ONE query, keyed by partnerId — a list
 * rendering a team cell per row must not issue a query per partner.
 *
 * Yields PEOPLE, not affiliations, because a list has no use for the period — which is
 * the whole difference from the singular above, and the reason for the longer name.
 *
 * A partner with nobody there today is absent from the map, not an empty array — same
 * contract as `profilesAsOf`, so callers default rather than distinguishing two empties.
 */
export async function rostersByPartnerAsOf(at: Date = new Date()) {
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
 * It exists so that query does not spell the rule a fourth time. `asOfWhere` at the top
 * of this module is the Prisma spelling and this is the SQL one; they are two renderings
 * of a single sentence and must change together, which is why both live here rather than
 * each in the module that needs it.
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

/**
 * Record "from `at`, this person is at `partnerId` as `role`", and leave the career
 * CONTIGUOUS around it. Returns the period it opened.
 *
 * A move is an INSERT INTO A TIMELINE, not an append — ADR
 * a-move-is-an-insert-into-a-timeline carries the rule, its edge cases and the readings
 * rejected. What it replaced was `where: { endDate: null }`, "close whatever period is
 * open", which is a different question and answered wrong the moment a move was
 * scheduled or backdated (autoknow-pvn). The three writes below are the rule's three
 * clauses, in order:
 *
 *  1. every period COVERING `at` ends there — selected with `asOfWhere`, so which row a
 *     move closes cannot drift from what the resolvers above call the job held then;
 *  2. a period left EMPTY by that is deleted, not kept as a zero-length row;
 *  3. the new period ends where the next one begins, or is open if none follows.
 *
 * No covering period is not an error: that is a hire being backdated in, or a return
 * from a gap, and only clause 3 applies. One transaction, because a career that is
 * contiguous only if all three writes land is not contiguous.
 */
export async function movePersonTo({ personId, partnerId, role, at }: {
  personId: number;
  partnerId: number;
  role: string;
  at: Date;
}) {
  return prisma.$transaction(async (tx) => {
    const covering = await tx.personAffiliation.findMany({
      where: { personId, ...asOfWhere(at) },
      select: { id: true, startDate: true },
    });
    // Strictly after: a period starting ON `at` is a COVERING period, handled below.
    const next = await tx.personAffiliation.findFirst({
      where: { personId, startDate: { gt: at } },
      orderBy: { startDate: 'asc' },
      select: { startDate: true },
    });

    // An exhaustive two-way split, because `asOfWhere` already bounds every row here to
    // `startDate <= at`. Spelled `>=` and not `===` because these are Date OBJECTS, on
    // which `===` is reference identity and matches nothing.
    const startsBefore = covering.filter((p) => p.startDate < at).map((p) => p.id);
    const startsOnMoveDate = covering.filter((p) => p.startDate >= at).map((p) => p.id);

    if (startsBefore.length > 0) {
      await tx.personAffiliation.updateMany({
        where: { id: { in: startsBefore } },
        data: { endDate: at },
      });
    }
    // Closing one of these at its own start would give `[at, at)` — half-open, so no day
    // at all. Guarded like the above because the ordinary move leaves this set empty, and
    // an `in: []` is a wasted round trip inside the transaction rather than a free no-op.
    if (startsOnMoveDate.length > 0) {
      await tx.personAffiliation.deleteMany({ where: { id: { in: startsOnMoveDate } } });
    }
    return tx.personAffiliation.create({
      data: { personId, partnerId, role, startDate: at, endDate: next?.startDate ?? null },
    });
  });
}
