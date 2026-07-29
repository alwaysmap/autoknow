import { prisma } from './db';
import type { EscalationRow } from '../components/EscalationRows';
import type {
  EscalationOrgLevel,
  EscalationSeverity,
  EscalationStatus,
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
} as const;

type Row = {
  id: number;
  title: string;
  status: string;
  severity: string | null;
  orgLevel: string | null;
  createdAt: Date;
  ownerPerson: { id: number; name: string } | null;
};

const toRow = (e: Row): EscalationRow => ({
  id: e.id,
  title: e.title,
  status: e.status as EscalationStatus,
  severity: e.severity as EscalationSeverity | null,
  orgLevel: e.orgLevel as EscalationOrgLevel | null,
  createdAt: e.createdAt.toISOString(),
  owner: e.ownerPerson,
});

export async function getPartnerEscalations(partnerId: number): Promise<EscalationRow[]> {
  const rows = await prisma.escalation.findMany({
    where: { partnerId },
    select: SELECT,
    orderBy: ORDER,
  });
  return rows.map(toRow);
}

export async function getProgramEscalations(projectId: number): Promise<EscalationRow[]> {
  const rows = await prisma.escalation.findMany({
    where: { projectId },
    select: SELECT,
    orderBy: ORDER,
  });
  return rows.map(toRow);
}
