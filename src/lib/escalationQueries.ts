import { Prisma } from '@prisma/client';
import { prisma } from './db';
import type { EscalationRow } from '../components/EscalationRows';
import {
  severityRank,
  orgLevelRank,
  type EscalationOrgLevel,
  type EscalationSeverity,
  type EscalationStatus,
} from './escalation';

// The entity-scoped escalation read, in ONE place (the `lib/partnerQueries` shape). The
// partner page and the program page ask the same question — "what has been escalated about
// this?" — and a second copy of the query is a second chance for one of them to order
// differently or forget the owner join. Server-only by dependency: it imports `lib/db`.

/** Open first, then newest — the ordering the section is read for. Severity is NOT the
 *  lead here, unlike the full listing: a per-entity panel is a handful of rows read in
 *  full, so recency is more useful than a triage ranking over four items. */
const ORDER = [{ status: 'asc' as const }, { createdAt: 'desc' as const }];

const SELECT = {
  id: true,
  title: true,
  status: true,
  severity: true,
  orgLevel: true,
  createdAt: true,
  ownerPerson: { select: { id: true, name: true } },
} satisfies Prisma.EscalationSelect;

/** Derived from `SELECT` rather than restated beside it: a hand-written mirror of a select
 *  is two adjacent literals that must be edited in step, and nothing says so when they are
 *  not. */
type Row = Prisma.EscalationGetPayload<{ select: typeof SELECT }>;

const toRow = (e: Row): EscalationRow => ({
  id: e.id,
  title: e.title,
  status: e.status as EscalationStatus,
  severity: e.severity as EscalationSeverity | null,
  orgLevel: e.orgLevel as EscalationOrgLevel | null,
  createdAt: e.createdAt.toISOString(),
  owner: e.ownerPerson,
});

/** ONE body; the three single-entity readers differ only in which column they scope by,
 *  which is the whole of the difference between "this partner's escalations", "this
 *  program's" and "this person's". */
async function escalationsWhere(where: Prisma.EscalationWhereInput): Promise<EscalationRow[]> {
  const rows = await prisma.escalation.findMany({ where, select: SELECT, orderBy: ORDER });
  return rows.map(toRow);
}

export const getPartnerEscalations = (partnerId: number): Promise<EscalationRow[]> =>
  escalationsWhere({ partnerId });

export const getProgramEscalations = (projectId: number): Promise<EscalationRow[]> =>
  escalationsWhere({ projectId });

/** The count the ecosystem strip's tile reads — cheap enough to be its own query rather
 *  than `getEcosystemEscalations(...).length`, which would fetch and sort full rows just
 *  to throw away everything but a number. */
export const getOpenEscalationsCount = (): Promise<number> =>
  prisma.escalation.count({ where: { status: 'open' } });

// A row that also carries what it's ABOUT — the shape both multi-entity panels need
// (ecosystem and person), since neither page can rely on "you're already looking at that
// entity" the way the partner/program pages do.
const WITH_ENTITY_SELECT = {
  ...SELECT,
  partner: { select: { name: true } },
  project: { select: { name: true } },
} satisfies Prisma.EscalationSelect;
type RowWithEntity = Prisma.EscalationGetPayload<{ select: typeof WITH_ENTITY_SELECT }>;

const toRowWithEntity = (e: RowWithEntity): EscalationRow => ({
  ...toRow(e),
  entityLabel: e.project?.name ?? e.partner?.name ?? null,
});

/**
 * A PERSON's escalations (#245 section C decision 9) — the three roles OR-ed, because
 * this is the "what is on my plate" read and omitting `requestedOfPersonId` would drop
 * the one role that most means "someone is waiting on you". Renders on BOTH `/people/:id`
 * and `/me` (decision 10) for free: `/me` renders the same `PersonProfile` component, so
 * there is exactly one call site to wire, not two.
 */
export async function getPersonEscalations(personId: number): Promise<EscalationRow[]> {
  const rows = await prisma.escalation.findMany({
    where: {
      OR: [
        { ownerPersonId: personId },
        { decisionMakerPersonId: personId },
        { requestedOfPersonId: personId },
      ],
    },
    select: WITH_ENTITY_SELECT,
    orderBy: ORDER,
  });
  return rows.map(toRowWithEntity);
}

/**
 * The ecosystem-wide leadership panel (#245 section C decision 9): open escalations only,
 * ranked severity -> org level -> OLDEST first, capped.
 *
 * "Oldest first" is the one place this query deliberately diverges from every other
 * escalation surface (which lead newest-first): the leadership question a dashboard
 * answers is "what has been sitting unanswered", and newest-first would hide exactly
 * that — a severity-1 escalation raised three weeks ago and a different one raised an
 * hour ago are not the same problem, and the older one is the one leadership needs to see.
 *
 * THE SORT (decision 11): `severityRank`/`orgLevelRank` are plain JS functions, not SQL —
 * they cannot be pushed into `orderBy`. Ordering by the raw enum in Postgres would sort by
 * DECLARATION order, which happens to read s1<s2<s3 today only by accident of how the
 * migration wrote the enum; it is not a rule Postgres is enforcing. So this fetches
 * open rows oldest-first (a real, stable SQL order) and re-sorts with the same rank
 * functions the full `/escalations` list already uses, relying on `Array.prototype.sort`
 * being STABLE (guaranteed since ES2019) to keep the oldest-first tiebreak for equal
 * severity/orgLevel — the same technique the list page uses client-side, done here
 * server-side because this panel has no interactive re-sort.
 */
export async function getEcosystemEscalations(limit = 10): Promise<EscalationRow[]> {
  // Bounded well above any real severity-1-and-unanswered backlog this app is sized for
  // (docs/adr ingestion-sized-for-hundreds) — a safety cap, not the panel's own limit.
  const FETCH_CAP = 500;
  const rows = await prisma.escalation.findMany({
    where: { status: 'open' },
    select: WITH_ENTITY_SELECT,
    orderBy: { createdAt: 'asc' },
    take: FETCH_CAP,
  });
  const sorted = [...rows].sort(
    (a, b) =>
      severityRank(a.severity as EscalationSeverity | null) -
        severityRank(b.severity as EscalationSeverity | null) ||
      orgLevelRank(a.orgLevel as EscalationOrgLevel | null) -
        orgLevelRank(b.orgLevel as EscalationOrgLevel | null),
  );
  return sorted.slice(0, limit).map(toRowWithEntity);
}
