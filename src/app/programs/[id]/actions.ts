'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { parseForm, projectLifecycleSchema, projectMetricsSchema } from '../../../lib/schemas';
import { prisma } from '../../../lib/db';
import { parseHealth } from '../../../lib/health';
import { parseSopInput } from '../../../lib/sop';
import { getCurrentUser } from '../../../lib/session';
import { requireOwner } from '../../../lib/owner';

// The program metadata dialog: the header's editable facts, plus the ProjectState row the
// same submit appends. One zod gate (lib/schemas), like its neighbour
// `setProjectLifecycle` — and like `updateNeedleStatus`, which appends that same state row
// through `statusUpdateSchema`, whose bound on the progress this one wrote raw is now the
// shared one both read (autoknow-9l4).
export async function updateProjectMetrics(formData: FormData) {
  const {
    projectId, theNeedle: needleLabel, ownerName, sopDate: sopMonth, volumeFirstYear,
    notes, hillChartProgress, partnerId, hasGas, hasGbi, hasDigitalKey, hasAap,
  } = parseForm(projectMetricsSchema, formData);

  // The owner must be an existing Person, stored by canonical email AND by id. The schema
  // settles that a name was submitted; only the directory settles that it names somebody.
  const owner = await requireOwner(ownerName);
  const theNeedle = parseHealth(needleLabel);
  const progress = hillChartProgress ?? 0;
  // SOP arrives as yyyy-MM (month picker) — stored as the LAST day of that month.
  const sopDate = sopMonth ? parseSopInput(sopMonth) : null;

  await prisma.project.update({
    where: { id: projectId },
    data: {
      theNeedle,
      hillChartProgress: progress,
      ...owner,
      sopDate,
      volumeFirstYear: volumeFirstYear ?? 0,
      hasGas,
      hasGbi,
      hasDigitalKey,
      hasAap,
      // Lead partner (OEM) is editable post-creation; no pick leaves it alone.
      ...(partnerId == null ? {} : { partnerId }),
    }
  });

  await prisma.projectState.create({
    data: {
      projectId,
      theNeedle,
      hillChartProgress: progress,
      notes,
      source: (await getCurrentUser()).handle
    }
  });

  revalidatePath(`/programs/${projectId}`);
}

export async function setProjectLifecycle(formData: FormData) {
  const { projectId, lifecycle } = parseForm(projectLifecycleSchema, formData);
  await prisma.project.update({ where: { id: projectId }, data: { lifecycle } });
  revalidatePath(`/programs/${projectId}`);
  revalidatePath('/programs');
  revalidatePath('/ecosystem');
}

export async function archiveProject(formData: FormData) {
  const projectIdStr = formData.get('projectId') as string;
  const projectId = parseInt(projectIdStr);
  if (!isNaN(projectId)) {
    const proj = await prisma.project.findUnique({ where: { id: projectId } });
    if (proj) {
      await prisma.project.update({
        where: { id: projectId },
        data: { isArchived: !proj.isArchived }
      });
    }
  }
  revalidatePath(`/programs/${projectIdStr}`);
}

export async function deleteProject(formData: FormData) {
  const projectIdStr = formData.get('projectId') as string;
  const projectId = parseInt(projectIdStr);
  if (!isNaN(projectId)) {
    const phases = await prisma.phase.findMany({ where: { projectId }, select: { id: true } });
    const phaseIds = phases.map(p => p.id);
    // Delete the whole object graph atomically so a mid-sequence failure can't
    // leave a half-deleted project behind.
    await prisma.$transaction([
      prisma.actionItem.deleteMany({ where: { phaseId: { in: phaseIds } } }),
      prisma.phaseState.deleteMany({ where: { phaseId: { in: phaseIds } } }),
      prisma.phasePartner.deleteMany({ where: { phaseId: { in: phaseIds } } }),
      prisma.phasePerson.deleteMany({ where: { phaseId: { in: phaseIds } } }),
      prisma.phaseDependency.deleteMany({
        where: {
          OR: [
            { phaseId: { in: phaseIds } },
            { dependsOnPhaseId: { in: phaseIds } }
          ]
        }
      }),
      prisma.contextRevision.deleteMany({
        where: { contextUrl: { OR: [{ projectId }, { phaseId: { in: phaseIds } }] } }
      }),
      prisma.contextUrl.deleteMany({
        where: { OR: [{ projectId }, { phaseId: { in: phaseIds } }] }
      }),
      prisma.phase.deleteMany({ where: { projectId } }),
      prisma.summary.deleteMany({ where: { scope: 'program', targetId: projectId } }),
      prisma.project.delete({ where: { id: projectId } })
    ]);
  }
  redirect('/ecosystem');
}

export async function addPhase(formData: FormData) {
  const projectIdStr = formData.get('projectId') as string;
  const name = formData.get('name') as string;
  const durationStr = formData.get('forecastedDuration') as string;
  const dependsOnStr = formData.get('dependsOn') as string; // optional "after X" phase id

  const projectId = parseInt(projectIdStr, 10);
  const forecastedDuration = parseInt(durationStr, 10) || 30;
  const dependsOnPhaseId = dependsOnStr ? parseInt(dependsOnStr, 10) : NaN;

  if (!isNaN(projectId) && name) {
    // Create the phase, its initial state, and the optional dependency atomically.
    await prisma.$transaction(async (tx) => {
      const phase = await tx.phase.create({
        data: {
          projectId,
          name: name.trim(),
          forecastedDuration
        }
      });

      await tx.phaseState.create({
        data: {
          phaseId: phase.id,
          status: 'Not Started',
          theNeedle: 'On Track',
          hillChartProgress: 0
        }
      });

      // A brand-new phase has no descendants, so an "after X" edge can never cycle —
      // just confirm the parent belongs to the same program.
      if (!isNaN(dependsOnPhaseId)) {
        const parent = await tx.phase.findUnique({ where: { id: dependsOnPhaseId }, select: { projectId: true } });
        if (parent?.projectId === projectId) {
          await tx.phaseDependency.create({ data: { phaseId: phase.id, dependsOnPhaseId } });
        }
      }
    });
  }

  revalidatePath(`/programs/${projectIdStr}`);
}

export async function deletePhase(formData: FormData) {
  const projectIdStr = formData.get('projectId') as string;
  const phaseIdStr = formData.get('phaseId') as string;

  const phaseId = parseInt(phaseIdStr, 10);

  if (!isNaN(phaseId)) {
    // Remove the phase and everything that references it atomically. Ingested context
    // is detached, not deleted — the digest may also matter to the project/partner.
    await prisma.$transaction([
      prisma.actionItem.deleteMany({ where: { phaseId } }),
      prisma.phaseState.deleteMany({ where: { phaseId } }),
      prisma.phasePartner.deleteMany({ where: { phaseId } }),
      prisma.contextUrl.updateMany({ where: { phaseId }, data: { phaseId: null } }),
      prisma.phaseDependency.deleteMany({
        where: {
          OR: [
            { phaseId },
            { dependsOnPhaseId: phaseId }
          ]
        }
      }),
      prisma.phase.delete({ where: { id: phaseId } })
    ]);
  }

  revalidatePath(`/programs/${projectIdStr}`);
}
