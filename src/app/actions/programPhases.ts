'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '../../lib/db';
import { validateTemplateDag } from '../../lib/templateDag';
import { deriveEndPhase } from '../../lib/programDag';

// Whole-graph save for a program's phase structure — the ONLY door for structural
// edits (the rail is read-only on structure). The client editor submits its complete
// draft; this re-validates the DAG with the same rules templates enforce (acyclic,
// single sink, full convergence — lib/programDag derives the end phase since Phase
// has no isEndPhase column) and applies the diff atomically: nothing is written
// unless the WHOLE resulting graph is valid, so a broken program cannot be persisted.
// Errors are RETURNED, not thrown — production masks thrown server-action messages.

export interface DraftPhasePayload {
  id: number; // real phase id, or negative = create
  name: string;
  forecastedDuration: number; // days
  dependsOn: number[]; // ids in the same payload (may be negative)
  description?: string | null; // Goal & DoD markdown (program-editable)
}

export interface SaveResult {
  error?: string;
}

export async function saveProgramPhases(formData: FormData): Promise<SaveResult> {
  const projectId = parseInt(formData.get('projectId') as string, 10);
  if (isNaN(projectId)) return { error: 'Invalid project' };

  let draft: DraftPhasePayload[];
  try {
    draft = JSON.parse(formData.get('payload') as string);
  } catch {
    return { error: 'Malformed payload' };
  }
  if (!Array.isArray(draft) || draft.some((d) => typeof d.id !== 'number' || !d.name?.trim())) {
    return { error: 'Malformed payload' };
  }

  // Validate the draft graph EXACTLY as the client did — the server is the gate.
  const nodes = draft.map((d, i) => ({ id: d.id, name: d.name, sortOrder: i, dependsOn: d.dependsOn }));
  const withEnd = deriveEndPhase(nodes);
  const validation = validateTemplateDag(
    withEnd.map((n) => ({ id: n.id, isEndPhase: n.isEndPhase, name: n.name })),
    draft.flatMap((d) => d.dependsOn.map((up) => ({ nodeId: d.id, dependsOnId: up }))),
  );
  if (!validation.ok) {
    return { error: validation.errors.map((e) => e.message).join(' ') };
  }

  // Kept/created ids must reconcile against the program's real phases.
  const existing = await prisma.phase.findMany({ where: { projectId }, select: { id: true } });
  const existingIds = new Set(existing.map((p) => p.id));
  const keptIds = draft.filter((d) => d.id > 0).map((d) => d.id);
  if (keptIds.some((id) => !existingIds.has(id))) {
    return { error: 'Phase does not belong to this program' };
  }
  const removedIds = [...existingIds].filter((id) => !keptIds.includes(id));

  await prisma.$transaction(async (tx) => {
    // 1. Remove deleted phases and everything that references them (context is
    //    detached, not deleted — the digest may matter to the project/partner).
    if (removedIds.length > 0) {
      await tx.actionItem.deleteMany({ where: { phaseId: { in: removedIds } } });
      await tx.phaseState.deleteMany({ where: { phaseId: { in: removedIds } } });
      await tx.phasePartner.deleteMany({ where: { phaseId: { in: removedIds } } });
      await tx.phasePerson.deleteMany({ where: { phaseId: { in: removedIds } } });
      await tx.contextUrl.updateMany({ where: { phaseId: { in: removedIds } }, data: { phaseId: null } });
      await tx.phaseDependency.deleteMany({
        where: { OR: [{ phaseId: { in: removedIds } }, { dependsOnPhaseId: { in: removedIds } }] },
      });
      await tx.phase.deleteMany({ where: { id: { in: removedIds } } });
    }

    // 2. Update kept phases; create new ones (negative draft ids) with a fresh state.
    const realId = new Map<number, number>();
    for (const d of draft) {
      if (d.id > 0) {
        realId.set(d.id, d.id);
        await tx.phase.update({
          where: { id: d.id },
          data: { name: d.name.trim(), forecastedDuration: Math.max(1, Math.round(d.forecastedDuration)), description: d.description ?? null },
        });
      } else {
        const created = await tx.phase.create({
          data: { projectId, name: d.name.trim(), forecastedDuration: Math.max(1, Math.round(d.forecastedDuration)), description: d.description ?? null },
        });
        await tx.phaseState.create({
          data: { phaseId: created.id, status: 'Not Started', theNeedle: 'On Track', hillChartProgress: 0 },
        });
        realId.set(d.id, created.id);
      }
    }

    // 3. Rebuild the dependency set to exactly match the validated draft.
    await tx.phaseDependency.deleteMany({ where: { phaseId: { in: [...realId.values()] } } });
    for (const d of draft) {
      for (const up of d.dependsOn) {
        await tx.phaseDependency.create({
          data: { phaseId: realId.get(d.id)!, dependsOnPhaseId: realId.get(up)! },
        });
      }
    }
  });

  revalidatePath(`/programs/${projectId}`);
  revalidatePath(`/programs/${projectId}/phases`);
  return {};
}
