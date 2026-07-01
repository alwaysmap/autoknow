'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '../../lib/db';
import { parseHealth } from '../../lib/health';
import { getCurrentUser } from '../../lib/session';

export async function updateNeedleStatus(formData: FormData) {
  const scope = formData.get('scope') as 'project' | 'partner' | 'phase';
  const targetIdStr = formData.get('targetId') as string;
  const theNeedleVal = formData.get('theNeedle') as string; // '1'..'4', a label, or a drag float
  const notes = formData.get('notes') as string || null;
  const hillChartProgressStr = formData.get('hillChartProgress') as string;
  const status = formData.get('status') as string || null;

  const targetId = parseInt(targetIdStr, 10);
  if (isNaN(targetId)) {
    throw new Error('Invalid target ID');
  }

  // The needle value is now program Health (On Track / Some Risk / Concerned).
  const theNeedle = parseHealth(theNeedleVal);
  const source = (await getCurrentUser()).handle;

  const hillChartProgress = hillChartProgressStr ? parseInt(hillChartProgressStr, 10) : NaN;

  if (scope === 'project') {
    const proj = await prisma.project.findUnique({ where: { id: targetId } });
    const finalProgress = !isNaN(hillChartProgress) ? hillChartProgress : (proj?.hillChartProgress ?? 0);

    // Update project risk level
    await prisma.project.update({
      where: { id: targetId },
      data: {
        theNeedle,
        hillChartProgress: finalProgress
      }
    });

    // Log history state
    await prisma.projectState.create({
      data: {
        projectId: targetId,
        theNeedle,
        hillChartProgress: finalProgress,
        notes,
        source
      }
    });

    revalidatePath(`/projects/${targetId}`);
  } else if (scope === 'partner') {
    // Preserve the latest recorded progress when this update is risk-only,
    // matching the project/phase scopes (which never reset progress to 0).
    const latestPartnerState = await prisma.partnerState.findFirst({
      where: { partnerId: targetId },
      orderBy: { timestamp: 'desc' }
    });
    const finalProgress = !isNaN(hillChartProgress)
      ? hillChartProgress
      : (latestPartnerState?.hillChartProgress ?? 0);

    // Log partner relationship history state
    await prisma.partnerState.create({
      data: {
        partnerId: targetId,
        theNeedle,
        hillChartProgress: finalProgress,
        notes,
        source
      }
    });

    revalidatePath(`/partners/${targetId}`);
  } else if (scope === 'phase') {
    const phase = await prisma.phase.findUnique({
      where: { id: targetId },
      include: { project: true }
    });

    if (phase) {
      const latestPhaseState = await prisma.phaseState.findFirst({
        where: { phaseId: targetId },
        orderBy: { timestamp: 'desc' }
      });

      const finalStatus = status || latestPhaseState?.status || 'Not Started';
      const finalProgress = !isNaN(hillChartProgress) ? hillChartProgress : (latestPhaseState?.hillChartProgress ?? 0);

      // Create new phase state log
      await prisma.phaseState.create({
        data: {
          phaseId: targetId,
          status: finalStatus,
          theNeedle,
          hillChartProgress: finalProgress,
          notes
        }
      });

      revalidatePath(`/projects/${phase.projectId}`);
    }
  }

  // Global views cache updates
  revalidatePath('/ecosystem-summary');
  revalidatePath('/me');
}
