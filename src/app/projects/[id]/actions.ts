'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '../../../lib/db';

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

  let theNeedle = 'Low';
  if (theNeedleVal === '1') theNeedle = 'Low';
  else if (theNeedleVal === '2') theNeedle = 'Medium';
  else if (theNeedleVal === '3') theNeedle = 'High';
  else if (theNeedleVal === '4') theNeedle = 'Critical';
  else if (theNeedleVal) theNeedle = theNeedleVal;

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
        source: 'dylan'
      }
    });
  }
  revalidatePath(`/projects/${projectIdStr}`);
}

export async function updatePhaseState(formData: FormData) {
  const projectIdStr = formData.get('projectId') as string;
  const phaseIdStr = formData.get('phaseId') as string;
  const status = formData.get('status') as string;
  const theNeedleVal = formData.get('theNeedle') as string;
  const hillChartProgressStr = formData.get('hillChartProgress') as string;
  const notes = formData.get('notes') as string || null;

  const phaseId = parseInt(phaseIdStr);
  const hillChartProgress = parseInt(hillChartProgressStr);

  let theNeedle = 'Low';
  if (!isNaN(phaseId)) {
    if (!theNeedleVal) {
      const latestState = await prisma.phaseState.findFirst({
        where: { phaseId },
        orderBy: { timestamp: 'desc' }
      });
      theNeedle = latestState?.theNeedle || 'Low';
    } else {
      if (theNeedleVal === '1') theNeedle = 'Low';
      else if (theNeedleVal === '2') theNeedle = 'Medium';
      else if (theNeedleVal === '3') theNeedle = 'High';
      else if (theNeedleVal === '4') theNeedle = 'Critical';
      else theNeedle = theNeedleVal;
    }

    await prisma.phaseState.create({
      data: {
        phaseId,
        status,
        theNeedle,
        hillChartProgress: !isNaN(hillChartProgress) ? hillChartProgress : 0,
        notes
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
    const phases = await prisma.phase.findMany({ where: { projectId } });
    const phaseIds = phases.map(p => p.id);
    await prisma.actionItem.deleteMany({ where: { phaseId: { in: phaseIds } } });
    await prisma.phaseState.deleteMany({ where: { phaseId: { in: phaseIds } } });
    await prisma.phaseDependency.deleteMany({
      where: {
        OR: [
          { phaseId: { in: phaseIds } },
          { dependsOnPhaseId: { in: phaseIds } }
        ]
      }
    });
    await prisma.phase.deleteMany({ where: { projectId } });
    await prisma.contextUrl.deleteMany({ where: { projectId } });
    await prisma.project.delete({ where: { id: projectId } });
  }
  redirect('/');
}

export async function addPhase(formData: FormData) {
  const projectIdStr = formData.get('projectId') as string;
  const name = formData.get('name') as string;
  const durationStr = formData.get('forecastedDuration') as string;

  const projectId = parseInt(projectIdStr, 10);
  const forecastedDuration = parseInt(durationStr, 10) || 30;

  if (!isNaN(projectId) && name) {
    const phase = await prisma.phase.create({
      data: {
        projectId,
        name: name.trim(),
        forecastedDuration
      }
    });

    await prisma.phaseState.create({
      data: {
        phaseId: phase.id,
        status: 'Not Started',
        theNeedle: 'Low',
        hillChartProgress: 0
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
    await prisma.actionItem.deleteMany({ where: { phaseId } });
    await prisma.phaseState.deleteMany({ where: { phaseId } });
    await prisma.phaseDependency.deleteMany({
      where: {
        OR: [
          { phaseId },
          { dependsOnPhaseId: phaseId }
        ]
      }
    });

    await prisma.phase.delete({ where: { id: phaseId } });
  }

  revalidatePath(`/projects/${projectIdStr}`);
}
