'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '../../../lib/db';
import { parseHealth } from '../../../lib/health';
import { getCurrentUser } from '../../../lib/session';

export async function updateActionItem(formData: FormData) {
  const actionItemIdStr = formData.get('actionItemId') as string;
  const status = formData.get('status') as string;
  const nextStep = formData.get('nextStep') as string;
  const linkUrl = formData.get('linkUrl') as string;
  const projectIdStr = formData.get('projectId') as string;

  const actionItemId = parseInt(actionItemIdStr);
  if (!isNaN(actionItemId)) {
    await prisma.actionItem.update({
      where: { id: actionItemId },
      data: {
        status,
        nextStep,
        linkUrl: linkUrl ? linkUrl.trim() : null
      }
    });
  }

  revalidatePath(`/projects/${projectIdStr}`);
}

export async function updateProjectMetrics(formData: FormData) {
  const projectIdStr = formData.get('projectId') as string;
  const theNeedleVal = formData.get('theNeedle') as string;
  const hillChartProgressStr = formData.get('hillChartProgress') as string;
  const ownerName = formData.get('ownerName') as string;
  const sopDateStr = formData.get('sopDate') as string;
  const volumeFirstYearStr = formData.get('volumeFirstYear') as string;
  const notes = formData.get('notes') as string || null;

  const theNeedle = parseHealth(theNeedleVal);

  const projectId = parseInt(projectIdStr);
  const hillChartProgress = parseInt(hillChartProgressStr);
  const volumeFirstYear = parseInt(volumeFirstYearStr);
  const sopDate = sopDateStr ? new Date(sopDateStr) : null;

  if (!isNaN(projectId)) {
    await prisma.project.update({
      where: { id: projectId },
      data: {
        theNeedle,
        hillChartProgress: !isNaN(hillChartProgress) ? hillChartProgress : 0,
        ownerName: ownerName || null,
        sopDate,
        volumeFirstYear: !isNaN(volumeFirstYear) ? volumeFirstYear : 0
      }
    });

    await prisma.projectState.create({
      data: {
        projectId,
        theNeedle,
        hillChartProgress: !isNaN(hillChartProgress) ? hillChartProgress : 0,
        notes,
        source: (await getCurrentUser()).handle
      }
    });
  }
  revalidatePath(`/projects/${projectIdStr}`);
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
  revalidatePath(`/projects/${projectIdStr}`);
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
      prisma.phaseDependency.deleteMany({
        where: {
          OR: [
            { phaseId: { in: phaseIds } },
            { dependsOnPhaseId: { in: phaseIds } }
          ]
        }
      }),
      prisma.contextUrl.deleteMany({
        where: { OR: [{ projectId }, { phaseId: { in: phaseIds } }] }
      }),
      prisma.phase.deleteMany({ where: { projectId } }),
      prisma.programBrief.deleteMany({ where: { projectId } }),
      prisma.project.delete({ where: { id: projectId } })
    ]);
  }
  redirect('/');
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

  revalidatePath(`/projects/${projectIdStr}`);
}

export async function editPhase(formData: FormData) {
  const projectIdStr = formData.get('projectId') as string;
  const phaseIdStr = formData.get('phaseId') as string;
  const name = formData.get('name') as string;
  const durationStr = formData.get('forecastedDuration') as string;

  const phaseId = parseInt(phaseIdStr, 10);
  const forecastedDuration = parseInt(durationStr, 10) || 30;

  if (!isNaN(phaseId) && name) {
    await prisma.phase.update({
      where: { id: phaseId },
      data: {
        name: name.trim(),
        forecastedDuration
      }
    });
  }

  revalidatePath(`/projects/${projectIdStr}`);
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

  revalidatePath(`/projects/${projectIdStr}`);
}
