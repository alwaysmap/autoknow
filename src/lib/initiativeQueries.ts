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

/** A real device Program linked to a membership (autoknow-hcz.14). `deviceId` is the
 *  link row's own id — what the unlink action names. */
export interface MemberDeviceRow {
  deviceId: number;
  projectId: number;
  name: string;
}

/** A candidate row for the Devices combobox — one of the partner's own real programs. */
export interface LinkableProgram {
  id: number;
  name: string;
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
  devices: MemberDeviceRow[]; // linked head-unit programs, name order
  /** The partner's own real, unarchived programs not yet linked — the Devices
   *  combobox's canonical rows (AGENTS lesson 3). Empty = nothing to link. */
  linkablePrograms: LinkableProgram[];
}

/** The devices read both surfaces use verbatim — the members table (via
 *  `getInitiativeDetail`) and the copy page's facts line (via
 *  `getMembershipDevices`) — so the two cannot drift on shape or order. */
const devicesInclude = {
  include: { project: { select: { id: true, name: true } } },
  orderBy: { project: { name: 'asc' as const } },
} as const;

const toMemberDeviceRows = (
  devices: { id: number; projectId: number; project: { name: string } }[],
): MemberDeviceRow[] =>
  devices.map((d) => ({ deviceId: d.id, projectId: d.projectId, name: d.project.name }));

/** The copy page's facts-line read (autoknow-hcz.14): the membership's linked device
 *  programs. Empty when the membership does not exist — a copy predating it renders
 *  no Devices fact rather than an error. */
export async function getMembershipDevices(initiativeId: number, partnerId: number): Promise<MemberDeviceRow[]> {
  const membership = await prisma.initiativePartner.findUnique({
    where: { initiativeId_partnerId: { initiativeId, partnerId } },
    include: { devices: devicesInclude },
  });
  return membership ? toMemberDeviceRows(membership.devices) : [];
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

/** "Active initiative" = not archived. ONE spelling, shared by the count and the list,
 *  so the strip tile's figure and the rows behind its link cannot drift apart. */
const ACTIVE_INITIATIVE_WHERE = { isArchived: false } as const;

/**
 * The ecosystem strip's tile figure (gh-286 part h): how many initiatives are live
 * right now. A count query of its own, deliberately NOT folded into
 * `getEcosystemDashboardData`: `/` renders the strip too and must not pay for the
 * full list's per-copy chain pass (the same boundary `getPartnerRelationshipScores`
 * keeps, lib/dashboardData.ts).
 */
export async function countActiveInitiatives(): Promise<number> {
  return prisma.initiative.count({ where: ACTIVE_INITIATIVE_WHERE });
}

export async function getInitiativesList(now: number): Promise<InitiativeListRow[]> {
  const initiatives = await prisma.initiative.findMany({
    where: ACTIVE_INITIATIVE_WHERE,
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
        include: {
          partner: {
            include: {
              region: true,
              // The Devices picker's candidate rows: the partner's own REAL programs
              // (`initiativeId: null` — a copy is workflow standing, not a device),
              // unarchived. The mutation boundary re-checks both rules.
              projects: {
                where: { initiativeId: null, isArchived: false },
                select: { id: true, name: true },
                orderBy: { name: 'asc' },
              },
            },
          },
          devices: devicesInclude,
        },
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
    const devices = toMemberDeviceRows(m.devices);
    // A linked program stays out of the picker — the one legal move left is unlink.
    const linkedIds = new Set(devices.map((d) => d.projectId));
    const linkablePrograms = m.partner.projects.filter((p) => !linkedIds.has(p.id));
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
        devices,
        linkablePrograms,
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
      devices,
      linkablePrograms,
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
