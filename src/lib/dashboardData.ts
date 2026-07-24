import { prisma } from './db';
import { percentile } from './stats';
import { computeCriticalChain } from './criticalChain';
import { deriveScore } from './relationship';
import { deriveProgramStatus } from './lifecycle';
import { buildBusiestResources, type BusiestRow } from './chainLedger';
import { getProgramLedgers } from './chainLedgerData';
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
}

export interface DashboardPerson {
  id: number;
  name: string;
  email: string;
}

/**
 * A phase that is ON a live critical chain right now — i.e. actually gating an SOP,
 * which is NOT the same claim as "the phase that historically takes longest"
 * (ADR forecasts-derive-from-the-real-chain-never-a-synthetic-model). The measure is
 * how many live programs it is gating; there is no duration here, because the
 * duration of a phase NAME across programs is a different question again.
 */
export interface LiveConstraint {
  phaseName: string;
  programs: { id: number; name: string }[];
}

export interface EcosystemDashboardData {
  serializedProjects: DashboardProject[];
  people: DashboardPerson[];
  cycleTimeData: CycleTimeData[];
  cycleTimeStats: Record<string, CycleTimeStats>;
  /** Cross-portfolio constraint resources (docs/CRITICAL_CHAIN_VIEW_PLAN.md §4c). */
  busiest: BusiestRow[];
  /** Which PHASES sit on a live critical chain right now, most-blocking first (#129). */
  liveConstraints: LiveConstraint[];
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

  // Filled by the map below: one entry per live program that HAS a constraint.
  const constraintHits: { phaseName: string; program: { id: number; name: string } }[] = [];

  const serializedProjects: DashboardProject[] = projects.map((proj) => {
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

    const constraintPhase = chain.constraintId
      ? proj.phases.find((p) => p.id === chain.constraintId)
      : undefined;
    // `lib/lifecycle` owns "is this program live" — inlining the predicate is exactly
    // how it drifts per call site (it also classes progress >= 100 as Done, which the
    // inline version called live).
    if (constraintPhase && deriveProgramStatus(proj) === 'Active') {
      constraintHits.push({ phaseName: constraintPhase.name, program: { id: proj.id, name: proj.name } });
    }

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
    };
  });

  // Group by phase NAME: the same phase recurs across programs under one name, and
  // "Compliance Testing is gating four SOPs" is the portfolio-level fact. Most-blocking
  // first. Ties fall back to the project query's order, which is unspecified — the
  // grouping is a set, so the display does not depend on it.
  const byPhaseName = new Map<string, { id: number; name: string }[]>();
  for (const hit of constraintHits) {
    const seen = byPhaseName.get(hit.phaseName);
    if (seen) seen.push(hit.program);
    else byPhaseName.set(hit.phaseName, [hit.program]);
  }
  const liveConstraints: LiveConstraint[] = [...byPhaseName.entries()]
    .map(([phaseName, programs]) => ({ phaseName, programs }))
    .sort((a, b) => b.programs.length - a.programs.length);

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

  // Busiest people and partners: full chain ledgers per live program (buffer +
  // four-week trend from the state-history replay), aggregated per resource.
  const bundles = await getProgramLedgers(Date.now());
  const busiest = buildBusiestResources(
    bundles.map((b) => ({
      programId: b.programId,
      programName: b.programName,
      bufferDays: b.ledger.bufferDays,
      fourWeekDeltaDays: b.ledger.fourWeekDeltaDays,
      volumeFirstYear: b.volumeFirstYear,
      products: b.products,
      sopDate: b.sopDate,
      resources: b.chainResources,
    })),
  );

  return { serializedProjects, liveConstraints, people, cycleTimeData, cycleTimeStats, busiest };
}
