'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '../../lib/db';
import { parseHealth } from '../../lib/health';
import { getCurrentUser } from '../../lib/session';
import { parseForm, statusUpdateSchema } from '../../lib/schemas';

export async function updateNeedleStatus(formData: FormData) {
  // One zod gate (lib/schemas): scope, id, required note, bounded progress.
  const parsed = parseForm(statusUpdateSchema, formData);
  const { scope, targetId, notes } = parsed;

  // The needle value is now program Health (On Track / Some Risk / Concerned).
  const theNeedle = parseHealth(parsed.theNeedle);
  const source = (await getCurrentUser()).handle;

  const hillChartProgress = parsed.hillChartProgress ?? NaN;

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

    revalidatePath(`/programs/${targetId}`);
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
  }
  // Phase progress is a separate concern — see app/actions/hill.ts (updatePhaseHill).

  // Global views cache updates
  revalidatePath('/ecosystem-summary');
  revalidatePath('/me');
}
