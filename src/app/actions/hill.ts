'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '../../lib/db';
import { getCurrentUser } from '../../lib/session';
import { hillStatus } from '../../lib/phase';

// A single-phase hill-chart update: move the dot (progress) + a REQUIRED note — a
// position change without words is unreadable later, and the AI brief digests the
// words. Records a new PhaseState row — 0..100 progress, timestamp, notes, phaseId,
// and the person who made it. The previous update is recovered by ordering on
// timestamp. Status is inferred from progress, never picked.
export async function updatePhaseHill(formData: FormData) {
  const phaseId = parseInt(formData.get('phaseId') as string, 10);
  const projectIdStr = formData.get('projectId') as string;
  const progressStr = formData.get('hillChartProgress') as string;
  const notes = ((formData.get('notes') as string) || '').trim() || null;

  if (isNaN(phaseId)) throw new Error('Invalid phase ID');
  if (!notes) throw new Error('A note is required with a hill update');

  const latest = await prisma.phaseState.findFirst({
    where: { phaseId },
    orderBy: { timestamp: 'desc' },
  });

  const progress = progressStr ? parseInt(progressStr, 10) : latest?.hillChartProgress ?? 0;
  // The status column is kept populated for continuity, but it is derived from progress —
  // not a user choice — so display never depends on the stored value.
  const status = hillStatus(progress);
  const source = (await getCurrentUser()).handle;

  await prisma.phaseState.create({
    data: {
      phaseId,
      status,
      // Health lives on the program needle; carry the phase's last value for continuity.
      theNeedle: latest?.theNeedle ?? 'On Track',
      hillChartProgress: progress,
      notes,
      source,
    },
  });

  const projectId = parseInt(projectIdStr, 10);
  if (!isNaN(projectId)) revalidatePath(`/programs/${projectId}`);
  revalidatePath('/'); // the ecosystem feed lives on the home page
  revalidatePath('/ecosystem-summary');
}
