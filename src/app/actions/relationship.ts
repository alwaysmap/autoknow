'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '../../lib/db';
import { getCurrentUser } from '../../lib/session';
import { parseScore, scoreToHealth } from '../../lib/relationship';

// Log a partner relationship update: a 1..7 score plus a required note. The needle
// action stays program-only — partner health is a scale, not a gauge (lib/relationship).

export async function updatePartnerRelationship(formData: FormData) {
  const partnerId = parseInt(formData.get('partnerId') as string, 10);
  const score = parseScore(formData.get('score') as string);
  const notes = ((formData.get('notes') as string) || '').trim();

  if (Number.isNaN(partnerId)) throw new Error('Invalid partner ID');
  if (score === null) throw new Error('A relationship score (1–7) is required');
  if (!notes) throw new Error('Every relationship update needs a note');

  const source = (await getCurrentUser()).handle;

  // hillChartProgress is meaningless for relationships; carry the last value so
  // nothing that still reads it sees a reset.
  const latest = await prisma.partnerState.findFirst({
    where: { partnerId },
    orderBy: { timestamp: 'desc' },
  });

  await prisma.partnerState.create({
    data: {
      partnerId,
      relationshipScore: score,
      theNeedle: scoreToHealth(score), // keep feed/filters coherent
      hillChartProgress: latest?.hillChartProgress ?? 0,
      notes,
      source,
    },
  });

  revalidatePath(`/partners/${partnerId}`);
  revalidatePath('/partners');
}
