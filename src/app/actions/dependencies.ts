'use server';

import { revalidatePath } from 'next/cache';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/db';

// CRUD for phase dependencies (the DAG edges the PhaseGraph rail draws). Errors are
// RETURNED, not thrown — thrown server-action messages are masked in production, and
// the cycle rejection must reach the row inline.

export interface DependencyResult {
  error?: string;
}

/** Walk upstream from `fromId`; true if `targetId` is reachable (i.e. an ancestor). */
async function isAncestor(
  db: Prisma.TransactionClient,
  targetId: number,
  fromId: number,
): Promise<boolean> {
  const seen = new Set<number>();
  let frontier = [fromId];
  while (frontier.length > 0) {
    const edges = await db.phaseDependency.findMany({
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

  // Insert-then-revalidate inside one serializable transaction: two concurrent adds
  // (A→B and B→A) each pass a pre-insert cycle walk, so the cycle check must run
  // AFTER the insert, where serializable isolation forces one writer to abort. The
  // @@unique backstop turns a duplicate race into a readable error, not a second edge.
  try {
    await prisma.$transaction(
      async (tx) => {
        await tx.phaseDependency.create({ data: { phaseId, dependsOnPhaseId } });
        // Reject cycles: the new parent must not already sit downstream of this
        // phase — i.e. this phase must not be an ancestor of the proposed parent.
        if (await isAncestor(tx, phaseId, dependsOnPhaseId)) {
          throw new Error('CYCLE');
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (e) {
    if (e instanceof Error && e.message === 'CYCLE') {
      return { error: `Rejected — "${parent.name}" already depends on this phase (cycle)` };
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return { error: 'Already a dependency' };
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034') {
      return { error: 'Concurrent edit collided — try again' };
    }
    throw e;
  }
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
