import { prisma } from './db';
import { runMonteCarlo } from './forecast';
import { percentile } from './stats';
import { computeCriticalChain } from './criticalChain';
import { deriveScore } from './relationship';
import type { CycleTimeData, CycleTimeStats } from '../components/CycleTimeScatterPlot';

// Shared loader for the ecosystem dashboards. The home page (`/`) and the
// `/ecosystem-summary` page render different client components over the *same*
// underlying data, so the fetching/serialization lives here once instead of being
// duplicated (and drifting) across both routes.

export interface DashboardProject {
  id: number;
  name: string;
  isArchived: boolean;
  lifecycle: string;
  theNeedle: string;
  hillChartProgress: number;
  sopDate: string | null;
  ownerName: string | null;
  volumeFirstYear: number;
  hasGas: boolean;
  hasGbi: boolean;
  hasDigitalKey: boolean;
  hasAap: boolean;
  /** Remaining forecast days along the critical chain — the on-track signal vs SOP. */
  chainRemainingDays: number;
  latestNote: string | null;
  partner: { id: number; name: string };
  phases: {
    id: number;
    name: string;
    states: { status: string; theNeedle: string | null; hillChartProgress: number | null }[];
  }[];
  forecast: { remainingPhases: number; sim: { p50: number; p85: number; p95: number } };
}

export interface DashboardPerson {
  id: number;
  name: string;
  email: string;
}

export interface EcosystemDashboardData {
  serializedProjects: DashboardProject[];
  p85LeadTime: number;
  people: DashboardPerson[];
  cycleTimeData: CycleTimeData[];
  cycleTimeStats: Record<string, CycleTimeStats>;
}

/**
 * Latest relationship score per partner, for the ecosystem relationship-mix tile.
 * Same rule as the /partners list: the newest PartnerState wins, and a row without a
 * stored score derives one from its legacy health (lib/relationship.deriveScore). A
 * partner with no state at all has never been rated → null.
 *
 * Deliberately NOT folded into getEcosystemDashboardData: /ecosystem-summary renders
 * the same projects but no partner health, and shouldn't pay for this query.
 */
export async function getPartnerRelationshipScores(): Promise<(number | null)[]> {
  const partners = await prisma.partner.findMany({
    select: {
      states: {
        orderBy: { timestamp: 'desc' },
        take: 1,
        select: { relationshipScore: true, theNeedle: true },
      },
    },
  });
  return partners.map((p) => (p.states[0] ? deriveScore(p.states[0]) : null));
}

export async function getEcosystemDashboardData(): Promise<EcosystemDashboardData> {
  const projects = await prisma.project.findMany({
    include: {
      partner: true,
      phases: {
        include: {
          states: { orderBy: { timestamp: 'desc' }, take: 1 },
          dependencies: true,
        },
      },
      states: { orderBy: { timestamp: 'desc' }, take: 1, select: { notes: true } },
    },
  });

  const serializedProjects: DashboardProject[] = projects.map((proj) => {
    // Unstarted = the dot never left zero. Derived from progress — the stored status
    // string is legacy and never authoritative (see lib/phase.hillStatus).
    const unstartedCount = proj.phases.filter(
      (p) => (p.states[0]?.hillChartProgress ?? 0) <= 0,
    ).length;
    const sim = runMonteCarlo(unstartedCount, proj.id);

    // Remaining chain work (days) — notional phase weeks against the SOP target.
    const chain = computeCriticalChain(
      proj.phases.map((p) => ({
        id: p.id,
        name: p.name,
        forecastedDuration: p.forecastedDuration,
        progress: p.states[0]?.hillChartProgress ?? 0,
        parentIds: p.dependencies.map((d) => d.dependsOnPhaseId),
      })),
    );

    return {
      id: proj.id,
      name: proj.name,
      isArchived: proj.isArchived,
      lifecycle: proj.lifecycle,
      theNeedle: proj.theNeedle,
      hillChartProgress: proj.hillChartProgress,
      sopDate: proj.sopDate ? proj.sopDate.toISOString() : null,
      ownerName: proj.ownerName,
      volumeFirstYear: proj.volumeFirstYear,
      hasGas: proj.hasGas,
      hasGbi: proj.hasGbi,
      hasDigitalKey: proj.hasDigitalKey,
      hasAap: proj.hasAap,
      chainRemainingDays: chain.remainingDays,
      latestNote: proj.states[0]?.notes ?? null,
      partner: { id: proj.partner.id, name: proj.partner.name },
      phases: proj.phases.map((p) => ({
        id: p.id,
        name: p.name,
        states: p.states.map((s) => ({
          status: s.status,
          theNeedle: s.theNeedle,
          hillChartProgress: s.hillChartProgress,
        })),
      })),
      forecast: { remainingPhases: unstartedCount, sim },
    };
  });

  const people = await prisma.person.findMany({
    select: { id: true, name: true, email: true },
  });

  // Cycle times per phase: elapsed days from the first in-flight state (progress moved
  // off zero) to the first completed state (progress reached 100), or to now if still
  // in flight, for non-archived projects. Derived from progress — the stored status
  // string is legacy and never authoritative (see lib/phase.hillStatus).
  //
  // PhaseState is append-only and this loader runs on every dashboard request, so the
  // start/finish timestamps are aggregated in SQL — never by materializing each
  // phase's full state history into memory.
  const spans = await prisma.$queryRaw<
    { id: number; name: string; startedAt: Date | null; finishedAt: Date | null }[]
  >`
    SELECT p.id, p.name,
           MIN(s."timestamp") FILTER (WHERE s."hillChartProgress" > 0)    AS "startedAt",
           MIN(s."timestamp") FILTER (WHERE s."hillChartProgress" >= 100) AS "finishedAt"
    FROM "Phase" p
    JOIN "Project" proj ON proj.id = p."projectId"
    LEFT JOIN "PhaseState" s ON s."phaseId" = p.id
    WHERE proj."isArchived" = false
    GROUP BY p.id, p.name`;

  const cycleTimeData: CycleTimeData[] = [];
  for (const span of spans) {
    if (!span.startedAt) continue;
    const end = span.finishedAt ?? new Date();
    const days = Math.max(1, Math.round((end.getTime() - span.startedAt.getTime()) / (1000 * 60 * 60 * 24)));
    cycleTimeData.push({
      phaseId: span.id,
      phaseName: span.name,
      cycleTimeDays: days,
      isFinished: !!span.finishedAt,
    });
  }

  const cycleTimeStats: Record<string, CycleTimeStats> = {};
  const groupedByName: Record<string, number[]> = {};
  for (const ct of cycleTimeData) {
    if (ct.isFinished) {
      if (!groupedByName[ct.phaseName]) groupedByName[ct.phaseName] = [];
      groupedByName[ct.phaseName].push(ct.cycleTimeDays);
    }
  }
  for (const [name, daysArr] of Object.entries(groupedByName)) {
    if (daysArr.length > 0) {
      cycleTimeStats[name] = {
        p50: percentile(daysArr, 0.5),
        p85: percentile(daysArr, 0.85),
        p95: percentile(daysArr, 0.95),
      };
    }
  }

  // p85 lead time: 85th percentile of elapsed days across active (unfinished) WIP phases.
  const activeWipDurations = cycleTimeData.filter((ct) => !ct.isFinished).map((ct) => ct.cycleTimeDays);
  const p85LeadTime = activeWipDurations.length > 0 ? Math.round(percentile(activeWipDurations, 0.85)) : 14;

  return { serializedProjects, p85LeadTime, people, cycleTimeData, cycleTimeStats };
}
