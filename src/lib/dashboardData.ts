import { prisma } from './db';
import { percentile } from './stats';
import { computeCriticalChain } from './criticalChain';
import { deriveScore } from './relationship';
import { deriveProgramStatus } from './lifecycle';
import { buildBusiestResources, type BusiestRow } from './chainLedger';
import { getProgramLedgers } from './chainLedgerData';
import { constraintDiagnosis } from './chainInsights';
import { compareInsights, INSIGHT_SEVERITY_RANK, type Insight } from './insight';
import type { CycleTimeData, CycleTimeStats } from '../components/CycleTimeScatterPlot';
import type { PersonRef } from '../components/PersonCell';

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
  /** The program's Googler owner, resolved through `Project.ownerPersonId` (#127 E7).
   *  Was the stored `ownerName` string, re-matched client-side against the directory. */
  owner: PersonRef | null;
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


/** One program's live constraint, with WHY it is the constraint (#148). */
export interface ConstraintDiagnosis {
  program: { id: number; name: string };
  /** The diagnosis from `lib/chainInsights` — the ledger's own Situation packets, not a
   *  second reading of the phase. Null only if the program's ledger has no constraint,
   *  which the grouping below already excludes. */
  insight: Insight;
}

/**
 * A phase that is ON a live critical chain right now — i.e. actually gating an SOP,
 * which is NOT the same claim as "the phase that historically takes longest"
 * (ADR forecasts-derive-from-the-real-chain-never-a-synthetic-model). Grouped by phase
 * NAME, because "Compliance Testing is gating four SOPs" is the portfolio-level fact and
 * the reason this panel exists.
 *
 * Since #148 each row also carries WHY, per program: `diagnoses` holds one `Insight` per
 * gated program and `worst` is the one the row states. The panel used to name the phase
 * and stop — a reader who already knew from the needle that a program was at risk learned
 * that a phase called "Integration" was on its chain, and still could not tell whether it
 * was late, blocked, contended, or simply the longest step in a healthy plan.
 *
 * There is still no DURATION for the phase name across programs, deliberately: that is a
 * different question, and averaging four programs' overruns into one number would be the
 * kind of asserted-not-computed claim this family of issues exists to remove.
 */
export interface LiveConstraint {
  phaseName: string;
  programs: { id: number; name: string }[];
  diagnoses: ConstraintDiagnosis[];
  /** Worst-first head of `diagnoses` — what the row's Why and Since columns state. */
  worst: ConstraintDiagnosis;
}

export interface EcosystemDashboardData {
  serializedProjects: DashboardProject[];
  cycleTimeData: CycleTimeData[];
  cycleTimeStats: CycleTimeStats | null;
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
    // Initiative copies are excluded from every ecosystem program count, tally and
    // chart this loader feeds (gh-286 decision 5).
    where: { initiativeId: null },
    include: {
      partner: true,
      ownerPerson: { select: { id: true, name: true } }, // the owner by REFERENCE (#127 E7)
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
      owner: proj.ownerPerson,
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

  // Cycle times per phase: elapsed days from the first in-flight state (progress moved
  // off zero) to the first completed state (progress reached 100), or to now if still
  // in flight, for non-archived projects. Derived from progress — the stored status
  // string is legacy and never authoritative (see lib/phase.hillStatus).
  //
  // PhaseState is append-only and this loader runs on every dashboard request, so the
  // start/finish timestamps are aggregated in SQL — never by materializing each
  // phase's full state history into memory.
  const spans = await prisma.$queryRaw<
    {
      id: number; name: string; projectId: number; programName: string;
      startedAt: Date | null; finishedAt: Date | null;
    }[]
  >`
    SELECT p.id, p.name, proj.id AS "projectId", proj.name AS "programName",
           MIN(s."timestamp") FILTER (WHERE s."hillChartProgress" > 0)    AS "startedAt",
           MIN(s."timestamp") FILTER (WHERE s."hillChartProgress" >= 100) AS "finishedAt"
    FROM "Phase" p
    JOIN "Project" proj ON proj.id = p."projectId"
    LEFT JOIN "PhaseState" s ON s."phaseId" = p.id
    WHERE proj."isArchived" = false
      AND proj."initiativeId" IS NULL -- initiative copies excluded (gh-286 decision 5)
    GROUP BY p.id, p.name, proj.id, proj.name`;

  // FINISHED phases only. Cycle time is a completed-work measure: an in-flight phase has
  // an elapsed time, not a cycle time, and mixing the two understates the distribution —
  // every unfinished phase enters the sample at less than its eventual duration and drags
  // the percentiles down. Work still in flight is a different question (how long has this
  // been open, and is that unusual), answered by an Aging WIP chart rather than here.
  const cycleTimeData: CycleTimeData[] = [];
  for (const span of spans) {
    if (!span.startedAt || !span.finishedAt) continue;
    const days = Math.max(1, Math.round(
      (span.finishedAt.getTime() - span.startedAt.getTime()) / (1000 * 60 * 60 * 24)));
    cycleTimeData.push({
      phaseId: span.id,
      phaseName: span.name,
      projectId: span.projectId,
      programName: span.programName,
      finishedAt: span.finishedAt.toISOString(),
      cycleTimeDays: days,
    });
  }

  // ONE population, not one per phase name. Grouping by name was a false classification:
  // it split a 67-point sample into 44 buckets averaging 1.5 items each, so most "P50"s
  // were a single observation wearing a percentile's name — and because the key was the
  // raw string, four of those buckets were the SAME phase split by capitalisation.
  // `sampleSize` ships with the percentiles — `CycleTimeStats.sampleSize` says why it is
  // not an optional extra.
  const finishedDays = cycleTimeData.map((ct) => ct.cycleTimeDays);
  const cycleTimeStats: CycleTimeStats | null = finishedDays.length
    ? {
      p50: percentile(finishedDays, 0.5),
      p85: percentile(finishedDays, 0.85),
      p95: percentile(finishedDays, 0.95),
      sampleSize: finishedDays.length,
    }
    : null;

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

  // Group by phase NAME: the same phase recurs across programs under one name, and
  // "Compliance Testing is gating four SOPs" is the portfolio-level fact.
  //
  // Built HERE, after the bundles, because since #148 a row carries WHY as well as where
  // — and the why is the ledger's own Situation packets, which the bundles above already
  // hold. No extra query: this page was computing the whole diagnosis for `busiest` and
  // throwing the situations away. `constraintHits` is still the gate on WHICH programs
  // appear (deriveProgramStatus === 'Active'), which is strictly narrower than the bundle
  // query's filter, so every hit has a bundle.
  const byPhaseName = new Map<string, ConstraintDiagnosis[]>();
  const ledgerOf = new Map(bundles.map((b) => [b.programId, b]));
  for (const hit of constraintHits) {
    const bundle = ledgerOf.get(hit.program.id);
    const insight = bundle ? constraintDiagnosis(bundle.ledger, { programId: hit.program.id, programName: hit.program.name }) : null;
    if (!insight) continue;
    const entry = { program: hit.program, insight };
    const seen = byPhaseName.get(hit.phaseName);
    if (seen) seen.push(entry);
    else byPhaseName.set(hit.phaseName, [entry]);
  }
  const liveConstraints: LiveConstraint[] = [...byPhaseName.entries()]
    .map(([phaseName, entries]) => {
      // Worst program first WITHIN the row, so `worst` is the one the row states.
      const diagnoses = [...entries].sort((a, b) => compareInsights(a.insight, b.insight));
      return { phaseName, programs: diagnoses.map((d) => d.program), diagnoses, worst: diagnoses[0] };
    })
    // Severity leads the page now: a phase that is 40% over and gates two SOPs is a worse
    // read than a healthy phase gating four, and the old count-only order buried it.
    // Gating count still breaks the tie, because that is this panel's own contribution.
    .sort((a, b) =>
      INSIGHT_SEVERITY_RANK[a.worst.insight.severity] - INSIGHT_SEVERITY_RANK[b.worst.insight.severity]
      || b.programs.length - a.programs.length
      || a.phaseName.localeCompare(b.phaseName));

  return { serializedProjects, liveConstraints, cycleTimeData, cycleTimeStats, busiest };
}
