import 'server-only';
import { prisma } from './db';
import { isPhaseActive } from './phase';

// THE definition of "what is this person working on RIGHT NOW", in one place (#167).
//
// It existed twice before, in two shapes that could not be compared: the program page
// counted a program owner's other active phases inline (`p > 0 && p < 100` over programs
// they own), and the person page's Programs table had no notion of active work at all —
// its intro said so. So the Critical Chain bullet could say "on 13 active phases
// elsewhere" and the page it now links to had no way to show those thirteen.
//
// Two answers to "which work is active" is how a COUNT in a sentence and the ROWS behind
// its link start disagreeing, which is exactly what #167's acceptance test forbids. So
// both surfaces call this, and the predicate itself is `isPhaseActive` (lib/phase) — the
// same one the rail and the hill chart derive their status from, so an explicitly-started
// phase at 0% counts here too rather than only where someone remembered it.

/** One phase a person is actively working, with the program it belongs to. */
export interface ActivePhaseRef {
  projectId: number;
  projectName: string;
  phaseId: number;
  phaseName: string;
}

/**
 * A person's active work: every ACTIVE phase in a non-archived program they are attached
 * to. The three attachment routes are `personProgramRows`' own (#144) — but they do not
 * all reach the same distance, deliberately:
 *
 *  - **They LEAD the program** (`Project.ownerPersonId`): every active phase in it counts.
 *    A TEL is on the hook for the whole program, which is the claim the Critical Chain
 *    bullet has always made.
 *  - **They are NAMED on a phase** (`PhasePerson`, or an `ActionItem` riding a phase):
 *    only that phase counts. Being on one phase of a program says nothing about the rest.
 *
 * @param personId         the person whose work this is
 * @param excludeProjectId a program to leave out — the one already being read (the
 *                         Critical Chain bullet's "elsewhere")
 */
export async function personActivePhases(
  personId: number,
  { excludeProjectId }: { excludeProjectId?: number } = {},
): Promise<ActivePhaseRef[]> {
  const phases = await prisma.phase.findMany({
    where: {
      project: {
        isArchived: false,
        ...(excludeProjectId != null ? { id: { not: excludeProjectId } } : {}),
      },
      OR: [
        { project: { ownerPersonId: personId } },
        { people: { some: { personId } } },
        { actionItems: { some: { assignedToPersonId: personId } } },
      ],
    },
    select: {
      id: true,
      name: true,
      startedAt: true,
      project: { select: { id: true, name: true } },
      states: { orderBy: { timestamp: 'desc' }, take: 1, select: { hillChartProgress: true } },
    },
    orderBy: [{ projectId: 'asc' }, { id: 'asc' }],
  });

  return phases
    .filter((ph) => isPhaseActive(
      ph.states[0]?.hillChartProgress ?? 0,
      ph.startedAt ? ph.startedAt.toISOString() : null,
    ))
    .map((ph) => ({
      projectId: ph.project.id,
      projectName: ph.project.name,
      phaseId: ph.id,
      phaseName: ph.name,
    }));
}

/** The programs those phases belong to — what the person page's Programs table filters
 *  to, and what the Critical Chain bullet counts when it decides between naming one
 *  program inline and linking to all of them. */
export function activeProjectIds(phases: ActivePhaseRef[]): Set<number> {
  return new Set(phases.map((p) => p.projectId));
}
