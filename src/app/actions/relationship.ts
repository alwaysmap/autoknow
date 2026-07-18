'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '../../lib/db';
import { getCurrentUser } from '../../lib/session';
import { scoreToHealth, clampScore } from '../../lib/relationship';
import { parseForm, relationshipUpdateSchema } from '../../lib/schemas';

// Log a partner relationship update: a 1..7 score plus a required note. The needle
// action stays program-only — partner health is a scale, not a gauge (lib/relationship).

export async function updatePartnerRelationship(formData: FormData) {
  // One zod gate (lib/schemas): id, 1..5 score, and the required note.
  const { partnerId, score: rawScore, notes } = parseForm(relationshipUpdateSchema, formData);
  const score = clampScore(rawScore);

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
