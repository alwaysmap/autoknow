import { prisma } from './db';
import { runMonteCarlo } from './forecast';
import { percentile } from './stats';
import { computeCriticalChain } from './criticalChain';
import type { CycleTimeData, CycleTimeStats } from '../components/CycleTimeScatterPlot';

// Shared loader for the ecosystem dashboards. The home page (`/`) and the
// `/ecosystem-summary` page render different client components over the *same*
// underlying data, so the fetching/serialization lives here once instead of being
// duplicated (and drifting) across both routes.

export interface DashboardProject {
  id: number;
  name: string;
  isArchived: boolean;
  theNeedle: string;
  hillChartProgress: number;
  sopDate: string | null;
  ownerName: string | null;
  volumeFirstYear: number;
  hasGas: boolean;
  hasGbi: boolean;
  hasDigitalKey: boolean;
  /** Remaining forecast days along the critical chain — the on-track signal vs SOP. */
  chainRemainingDays: number;
  partner: { id: number; name: string };
  phases: {
    id: number;
    name: string;
    states: { status: string; theNeedle: string | null; hillChartProgress: number | null }[];
  }[];
  forecast: { remainingPhases: number; sim: { p50: number; p85: number; p95: number } };
}

export interface Briefing {
  projectId: number;
  projectName: string;
  partnerName: string;
  briefingText: string;
  timestamp: string;
}

export interface DashboardPerson {
  id: number;
  name: string;
  email: string;
}

export interface EcosystemDashboardData {
  serializedProjects: DashboardProject[];
  briefings: Briefing[];
  p85LeadTime: number;
  people: DashboardPerson[];
  cycleTimeData: CycleTimeData[];
  cycleTimeStats: Record<string, CycleTimeStats>;
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
      contextUrls: { orderBy: { id: 'desc' } },
    },
  });

  const serializedProjects: DashboardProject[] = projects.map((proj) => {
    const unstartedCount = proj.phases.filter(
      (p) => p.states[0]?.status === 'Not Started' || !p.states[0],
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
      theNeedle: proj.theNeedle,
      hillChartProgress: proj.hillChartProgress,
      sopDate: proj.sopDate ? proj.sopDate.toISOString() : null,
      ownerName: proj.ownerName,
      volumeFirstYear: proj.volumeFirstYear,
      hasGas: proj.hasGas,
      hasGbi: proj.hasGbi,
      hasDigitalKey: proj.hasDigitalKey,
      chainRemainingDays: chain.remainingDays,
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

  const briefings: Briefing[] = projects.flatMap((proj) =>
    proj.contextUrls
      .map((cu) => ({
        projectId: proj.id,
        projectName: proj.name,
        partnerName: proj.partner.name,
        briefingText: cu.ingestedText || '',
        timestamp: new Date().toLocaleDateString(),
      }))
      .filter((b) => b.briefingText),
  );

  const people = await prisma.person.findMany({
    select: { id: true, name: true, email: true },
  });

  // Cycle times per phase: elapsed days from the first in-flight state (progress moved
  // off zero) to the first completed state (progress reached 100), or to now if still
  // in flight, for non-archived projects. Derived from progress — the stored status
  // string is legacy and never authoritative (see lib/phase.hillStatus).
  const allPhases = await prisma.phase.findMany({
    include: {
      states: { orderBy: { timestamp: 'asc' } },
      project: { select: { isArchived: true } },
    },
  });

  const cycleTimeData: CycleTimeData[] = [];
  for (const phase of allPhases) {
    if (phase.project.isArchived) continue;

    let startWipDate: Date | null = null;
    let finishedDate: Date | null = null;
    for (const state of phase.states) {
      const progress = state.hillChartProgress ?? 0;
      if (progress > 0 && !startWipDate) startWipDate = state.timestamp;
      if (progress >= 100 && !finishedDate) finishedDate = state.timestamp;
    }

    if (startWipDate) {
      const end = finishedDate ? finishedDate : new Date();
      const days = Math.max(1, Math.round((end.getTime() - startWipDate.getTime()) / (1000 * 60 * 60 * 24)));
      cycleTimeData.push({
        phaseId: phase.id,
        phaseName: phase.name,
        cycleTimeDays: days,
        isFinished: !!finishedDate,
      });
    }
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

  return { serializedProjects, briefings, p85LeadTime, people, cycleTimeData, cycleTimeStats };
}
