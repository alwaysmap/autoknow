// Read shapes for the initiative surfaces (gh-286 parts d/e). Server-only (prisma).
// The derivations stay in lib/initiative.ts — this module only fetches and composes,
// so the list, the detail page and (later) the ecosystem tile cannot compute the same
// member's status two different ways.

import { prisma } from './db';
import { computeCriticalChain } from './criticalChain';
import { copyCompletion, memberStatus, initiativeRollup, activeStatuses, type MemberStatus, type InitiativeRollup } from './initiative';
import { productUnion, type PartnerProductKey } from './partnerProducts';

export interface InitiativeListRow {
  id: number;
  name: string;
  targetDate: string | null; // ISO
  isArchived: boolean;
  memberCount: number; // active members
  rollup: InitiativeRollup;
  createdAt: string; // ISO
}

export interface MemberPhaseReading {
  id: number;
  name: string;
  progress: number; // latest hill position 0–100
}

export interface InitiativeMemberRow {
  partnerId: number;
  partnerName: string;
  regionName: string;
  projectId: number | null; // the ACTIVE copy; null only if data predates the invariant
  /** The copy's stated health — the needle column reads it verbatim. */
  theNeedle: string | null;
  completion: number; // 0–100
  status: MemberStatus;
  targetDate: string | null; // the copy's own date (ISO)
  phases: MemberPhaseReading[]; // template order — every member shares the same steps
  joinedAt: string; // ISO
}

export interface InitiativeDetail {
  id: number;
  name: string;
  description: string | null;
  targetDate: string | null; // ISO
  isArchived: boolean;
  templateId: number;
  members: InitiativeMemberRow[];
  rollup: InitiativeRollup;
}

/** The copy include every loader here uses verbatim: phases in creation order
 *  (= template order, the creator writes them in sequence), the latest state each,
 *  and dependencies — `readCopy` always runs the chain, so every caller needs them. */
const copyInclude = {
  phases: {
    orderBy: { id: 'asc' as const },
    include: { states: { orderBy: { timestamp: 'desc' as const }, take: 1 }, dependencies: true },
  },
} as const;

type CopyWithPhases = {
  id: number;
  partnerId: number;
  isArchived: boolean;
  lifecycle: string;
  hillChartProgress: number;
  theNeedle: string;
  sopDate: Date | null;
  phases: { name: string; forecastedDuration: number; states: { hillChartProgress: number | null }[]; dependencies: { dependsOnPhaseId: number }[]; id: number }[];
};

function readCopy(copy: CopyWithPhases, now: number) {
  const phases = copy.phases.map((p) => ({ id: p.id, name: p.name, progress: p.states[0]?.hillChartProgress ?? 0 }));
  const completion = copyCompletion(phases.map((p) => p.progress));
  const chain = computeCriticalChain(
    copy.phases.map((p) => ({
      id: p.id,
      name: p.name,
      forecastedDuration: p.forecastedDuration,
      progress: p.states[0]?.hillChartProgress ?? 0,
      parentIds: p.dependencies.map((d) => d.dependsOnPhaseId),
    })),
  );
  const status = memberStatus(
    {
      isArchived: copy.isArchived,
      lifecycle: copy.lifecycle,
      // The lived reading, not the stored header field: a copy whose phases are all
      // done IS complete even if nobody bumped the header number.
      hillChartProgress: Math.max(copy.hillChartProgress, completion),
      sopDate: copy.sopDate ? copy.sopDate.toISOString() : null,
      chainRemainingDays: chain.remainingDays,
    },
    now,
  );
  return { phases, completion, status };
}

export async function getInitiativesList(now: number): Promise<InitiativeListRow[]> {
  const initiatives = await prisma.initiative.findMany({
    where: { isArchived: false },
    orderBy: { name: 'asc' },
    include: {
      members: { where: { status: 'active' } },
      copies: { where: { lifecycle: { not: 'cancelled' }, isArchived: false }, include: copyInclude },
    },
  });
  return initiatives.map((i) => {
    const activePartnerIds = new Set(i.members.map((m) => m.partnerId));
    const statuses = activeStatuses(
      i.copies.filter((c) => activePartnerIds.has(c.partnerId)).map((c) => readCopy(c, now).status),
    );
    return {
      id: i.id,
      name: i.name,
      targetDate: i.targetDate ? i.targetDate.toISOString() : null,
      isArchived: i.isArchived,
      memberCount: i.members.length,
      rollup: initiativeRollup(statuses),
      createdAt: i.createdAt.toISOString(),
    };
  });
}

export interface PartnerInitiativeRow {
  initiativeId: number;
  initiativeName: string;
  projectId: number | null; // this partner's active copy
  theNeedle: string | null;
  completion: number;
  status: MemberStatus;
  targetDate: string | null; // the copy's own date (ISO)
}

/** The partner page's #initiatives section (gh-286 part g): this partner's ACTIVE
 *  memberships, each read through the same derivations as every other surface. */
export async function getPartnerInitiatives(partnerId: number, now: number): Promise<PartnerInitiativeRow[]> {
  const memberships = await prisma.initiativePartner.findMany({
    where: { partnerId, status: 'active', initiative: { isArchived: false } },
    include: { initiative: { select: { id: true, name: true } } },
    orderBy: { initiative: { name: 'asc' } },
  });
  if (memberships.length === 0) return [];
  const copies = await prisma.project.findMany({
    where: {
      partnerId,
      initiativeId: { in: memberships.map((m) => m.initiativeId) },
      lifecycle: { not: 'cancelled' },
      isArchived: false,
    },
    include: copyInclude,
  });
  const copyByInitiative = new Map(copies.map((c) => [c.initiativeId!, c]));
  return memberships.map((m) => {
    const copy = copyByInitiative.get(m.initiativeId);
    if (!copy) {
      return {
        initiativeId: m.initiative.id,
        initiativeName: m.initiative.name,
        projectId: null,
        theNeedle: null,
        completion: 0,
        status: 'no-date' as const,
        targetDate: null,
      };
    }
    const { completion, status } = readCopy(copy, now);
    return {
      initiativeId: m.initiative.id,
      initiativeName: m.initiative.name,
      projectId: copy.id,
      theNeedle: copy.theNeedle,
      completion,
      status,
      targetDate: copy.sopDate ? copy.sopDate.toISOString() : null,
    };
  });
}

export interface AddablePartnerRow {
  id: number;
  name: string;
  typeName: string; // '' when the partner has no type (typeId is optional)
  regionName: string;
  /** Union of the product booleans across this partner's REAL device programs. */
  products: PartnerProductKey[];
}

/**
 * Candidates for the bulk-add table (gh-286 part f): every partner that is NOT an
 * active member of this initiative — a removed member reappears here, since re-adding
 * is a legal move (the action flips the one join row back). Products come from the
 * partner's own programs only, `initiativeId: null`: an initiative copy is created
 * with every product false and describes workflow standing, not devices, so counting
 * copies would let this initiative's own adds mutate the column that filters them.
 */
export async function getAddablePartners(initiativeId: number): Promise<AddablePartnerRow[]> {
  const partners = await prisma.partner.findMany({
    where: { NOT: { initiativeMemberships: { some: { initiativeId, status: 'active' } } } },
    include: {
      type: true,
      region: true,
      projects: {
        where: { initiativeId: null },
        select: { hasGas: true, hasGbi: true, hasDigitalKey: true, hasAap: true },
      },
    },
    orderBy: { name: 'asc' },
  });
  return partners.map((p) => ({
    id: p.id,
    name: p.name,
    typeName: p.type?.name ?? '',
    regionName: p.region.name,
    products: productUnion(p.projects),
  }));
}

export async function getInitiativeDetail(id: number, now: number): Promise<InitiativeDetail | null> {
  const initiative = await prisma.initiative.findUnique({
    where: { id },
    include: {
      members: {
        where: { status: 'active' },
        include: { partner: { include: { region: true } } },
        orderBy: { partner: { name: 'asc' } },
      },
      copies: {
        where: { lifecycle: { not: 'cancelled' }, isArchived: false },
        include: copyInclude,
      },
    },
  });
  if (!initiative) return null;

  const copyByPartner = new Map(initiative.copies.map((c) => [c.partnerId, c]));
  const members: InitiativeMemberRow[] = initiative.members.map((m) => {
    const copy = copyByPartner.get(m.partnerId);
    if (!copy) {
      // Data predating the add-creates-a-copy invariant (or a hand-edited row): shown
      // honestly as a member with no reading rather than hidden or defaulted (#129).
      return {
        partnerId: m.partnerId,
        partnerName: m.partner.name,
        regionName: m.partner.region.name,
        projectId: null,
        theNeedle: null,
        completion: 0,
        status: 'no-date' as const,
        targetDate: null,
        phases: [],
        joinedAt: m.joinedAt.toISOString(),
      };
    }
    const { phases, completion, status } = readCopy(copy, now);
    return {
      partnerId: m.partnerId,
      partnerName: m.partner.name,
      regionName: m.partner.region.name,
      projectId: copy.id,
      theNeedle: copy.theNeedle,
      completion,
      status,
      targetDate: copy.sopDate ? copy.sopDate.toISOString() : null,
      phases,
      joinedAt: m.joinedAt.toISOString(),
    };
  });

  return {
    id: initiative.id,
    name: initiative.name,
    description: initiative.description,
    targetDate: initiative.targetDate ? initiative.targetDate.toISOString() : null,
    isArchived: initiative.isArchived,
    templateId: initiative.templateId,
    members,
    rollup: initiativeRollup(activeStatuses(members.map((m) => m.status))),
  };
}
