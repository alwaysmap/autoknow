// Server-side loaders for the chain ledger (docs/CRITICAL_CHAIN_VIEW_PLAN.md §6).
// The replay needs each phase's full progress HISTORY — but only the narrow
// (phaseId, timestamp, progress) projection, fetched in one indexed query per call
// (never full PhaseState rows with notes; same spirit as the SQL aggregates in
// lib/dashboardData).

import { prisma } from './db';
import {
  computeChainLedger,
  type ChainLedgerResult,
  type LedgerPhaseInput,
  type StateTuple,
} from './chainLedger';

export interface ProgramLedgerBundle {
  programId: number;
  programName: string;
  sopDate: string | null;
  volumeFirstYear: number;
  products: string[];
  phases: LedgerPhaseInput[];
  states: StateTuple[];
  ledger: ChainLedgerResult;
  /** Involvement on unfinished planned-chain phases, for the busiest aggregation. Each
   *  carries the DEMAND WINDOW this program places on that resource — the hull of the
   *  schedule rows of the unfinished chain phases they are named on (#140). Without it
   *  "busy at once" means only "appears in these programs", and two programs wanting the
   *  same person in Q1 '27 and Q4 '28 look exactly like two that both want her next
   *  month. The windows cost nothing new: `ledger.schedule` already dates every phase to
   *  the day, actual or projected. */
  chainResources: {
    kind: 'partner' | 'person'; id: number; name: string; onConstraint: boolean;
    startMs: number; endMs: number;
  }[];
}

type PhaseWithLinks = {
  id: number;
  name: string;
  forecastedDuration: number;
  startedAt: Date | null;
  projectId: number;
  dependencies: { dependsOnPhaseId: number }[];
  partners: { partnerId: number; partner: { name: string } }[];
  people: { personId: number; person: { name: string } }[];
};

function productLabels(p: { hasGas: boolean; hasGbi: boolean; hasDigitalKey: boolean; hasAap: boolean }): string[] {
  const out: string[] = [];
  if (p.hasGas) out.push('GAS');
  if (p.hasGbi) out.push('GBI');
  if (p.hasDigitalKey) out.push('Digital Key');
  if (p.hasAap) out.push('AAP');
  return out;
}

/**
 * Ledger bundles for a set of programs (or all live programs when ids is omitted).
 * One project query + one narrow state-tuple query, then the pure lib per program.
 */
export async function getProgramLedgers(now: number, programIds?: number[]): Promise<ProgramLedgerBundle[]> {
  const projects = await prisma.project.findMany({
    where: programIds
      ? { id: { in: programIds } }
      // The enumerate-everything branch feeds portfolio surfaces (capacity, busiest),
      // so initiative copies stay out (gh-286 decision 5); a caller that NAMES ids —
      // a copy's own page — still gets them.
      : { isArchived: false, lifecycle: 'active', initiativeId: null },
    include: {
      phases: {
        include: {
          dependencies: { select: { dependsOnPhaseId: true } },
          partners: { select: { partnerId: true, partner: { select: { name: true } } } },
          people: { select: { personId: true, person: { select: { name: true } } } },
        },
      },
    },
  });
  const phaseIds = projects.flatMap((p) => p.phases.map((ph) => ph.id));
  if (phaseIds.length === 0) return [];

  const tuples = await prisma.$queryRaw<{ phaseId: number; timestamp: Date; hillChartProgress: number | null }[]>`
    SELECT "phaseId", "timestamp", "hillChartProgress"
    FROM "PhaseState"
    WHERE "phaseId" = ANY(${phaseIds})
    ORDER BY "timestamp" ASC`;
  const byPhase = new Map<number, { at: string; progress: number }[]>();
  for (const t of tuples) {
    if (t.hillChartProgress == null) continue;
    byPhase.set(t.phaseId, [...(byPhase.get(t.phaseId) ?? []), { at: t.timestamp.toISOString(), progress: t.hillChartProgress }]);
  }

  return projects.map((proj) => {
    const phases: LedgerPhaseInput[] = (proj.phases as PhaseWithLinks[]).map((ph) => {
      const hist = byPhase.get(ph.id) ?? [];
      const progress = hist.length ? hist[hist.length - 1].progress : 0;
      return {
        id: ph.id,
        name: ph.name,
        forecastedDuration: ph.forecastedDuration,
        progress,
        parentIds: ph.dependencies.map((d) => d.dependsOnPhaseId),
        // Explicit start (the Active toggle) wins over the derived first-progress
        // timestamp — same precedence as the program page.
        startedAt: ph.startedAt?.toISOString() ?? hist.find((h) => h.progress > 0)?.at ?? null,
        completedAt: hist.find((h) => h.progress >= 100)?.at ?? null,
      };
    });
    const states: StateTuple[] = (proj.phases as PhaseWithLinks[]).flatMap((ph) =>
      (byPhase.get(ph.id) ?? []).map((h) => ({ phaseId: ph.id, at: h.at, progress: h.progress })),
    );
    const sopDate = proj.sopDate ? proj.sopDate.toISOString() : null;
    const ledger = computeChainLedger({ phases, sopDate, now, states, volumeFirstYear: proj.volumeFirstYear });

    const unfinishedChain = new Set(
      ledger.plannedChain.path.filter((id) => (phases.find((p) => p.id === id)?.progress ?? 0) < 100),
    );
    const chainResources: ProgramLedgerBundle['chainResources'] = [];
    const rowOf = new Map(ledger.schedule.map((r) => [r.id, r]));
    for (const ph of proj.phases as PhaseWithLinks[]) {
      if (!unfinishedChain.has(ph.id)) continue;
      const onConstraint = ledger.liveConstraintId === ph.id;
      // The phase's own window, actual or projected — the schedule dates every row to
      // the day. A chain phase always has a row; the guard keeps the claim local.
      const row = rowOf.get(ph.id);
      if (!row) continue;
      const span = { startMs: row.startMs, endMs: row.endMs };
      for (const link of ph.partners) {
        chainResources.push({ kind: 'partner', id: link.partnerId, name: link.partner.name, onConstraint, ...span });
      }
      for (const link of ph.people) {
        chainResources.push({ kind: 'person', id: link.personId, name: link.person.name, onConstraint, ...span });
      }
    }
    // A resource can appear on several unfinished chain phases. Keep ONE entry per
    // resource per program — the aggregation counts a program once per resource — but
    // take the HULL of their windows, not the first one seen: somebody named on two
    // phases either side of the chain is wanted for the whole stretch, and reporting
    // only the first would understate the collision this is being computed for.
    // `onConstraint` still wins on the flag, as before.
    const deduped = new Map<string, ProgramLedgerBundle['chainResources'][number]>();
    for (const r of chainResources) {
      const key = `${r.kind}:${r.id}`;
      const prev = deduped.get(key);
      if (!prev) { deduped.set(key, r); continue; }
      deduped.set(key, {
        ...prev,
        onConstraint: prev.onConstraint || r.onConstraint,
        startMs: Math.min(prev.startMs, r.startMs),
        endMs: Math.max(prev.endMs, r.endMs),
      });
    }

    return {
      programId: proj.id,
      programName: proj.name,
      sopDate,
      volumeFirstYear: proj.volumeFirstYear,
      products: productLabels(proj),
      phases,
      states,
      ledger,
      chainResources: [...deduped.values()],
    };
  });
}
