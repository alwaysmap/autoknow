'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '../../lib/db';

// CRUD for phase dependencies (the DAG edges the PhaseGraph rail draws). Errors are
// RETURNED, not thrown — thrown server-action messages are masked in production, and
// the cycle rejection must reach the row inline.

export interface DependencyResult {
  error?: string;
}

/** Walk upstream from `fromId`; true if `targetId` is reachable (i.e. an ancestor). */
async function isAncestor(targetId: number, fromId: number): Promise<boolean> {
  const seen = new Set<number>();
  let frontier = [fromId];
  while (frontier.length > 0) {
    const edges = await prisma.phaseDependency.findMany({
      where: { phaseId: { in: frontier } },
      select: { dependsOnPhaseId: true },
    });
    const parents = edges.map((e) => e.dependsOnPhaseId).filter((id) => !seen.has(id));
    if (parents.includes(targetId)) return true;
    parents.forEach((id) => seen.add(id));
    frontier = parents;
  }
  return false;
}

export async function addPhaseDependency(formData: FormData): Promise<DependencyResult> {
  const phaseId = parseInt(formData.get('phaseId') as string, 10);
  const dependsOnPhaseId = parseInt(formData.get('dependsOnPhaseId') as string, 10);
  const projectIdStr = formData.get('projectId') as string;

  if (isNaN(phaseId) || isNaN(dependsOnPhaseId)) return { error: 'Invalid phase' };
  if (phaseId === dependsOnPhaseId) return { error: 'A phase cannot depend on itself' };

  const [phase, parent] = await Promise.all([
    prisma.phase.findUnique({ where: { id: phaseId }, select: { projectId: true } }),
    prisma.phase.findUnique({ where: { id: dependsOnPhaseId }, select: { projectId: true, name: true } }),
  ]);
  if (!phase || !parent || phase.projectId !== parent.projectId) {
    return { error: 'Phases must belong to the same program' };
  }

  const existing = await prisma.phaseDependency.findFirst({ where: { phaseId, dependsOnPhaseId } });
  if (existing) return { error: 'Already a dependency' };

  // Reject cycles: the new parent must not already sit downstream of this phase —
  // i.e. this phase must not be an ancestor of the proposed parent.
  if (await isAncestor(phaseId, dependsOnPhaseId)) {
    return { error: `Rejected — "${parent.name}" already depends on this phase (cycle)` };
  }

  await prisma.phaseDependency.create({ data: { phaseId, dependsOnPhaseId } });
  revalidatePath(`/programs/${projectIdStr}`);
  return {};
}

export async function removePhaseDependency(formData: FormData): Promise<DependencyResult> {
  const id = parseInt(formData.get('id') as string, 10);
  const projectIdStr = formData.get('projectId') as string;
  if (isNaN(id)) return { error: 'Invalid dependency' };

  await prisma.phaseDependency.deleteMany({ where: { id } });
  revalidatePath(`/programs/${projectIdStr}`);
  return {};
}
