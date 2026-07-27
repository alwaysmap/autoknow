'use server';

import { revalidatePath } from 'next/cache';
import { parseForm, phasePartnerAssignSchema } from '../../lib/schemas';
import { prisma } from '../../lib/db';
import { guarded, type ActionResult } from '../../lib/actionResult';
import {
  parseInvolvementLinkId, requirePartner, requirePhaseInProject, revalidateInvolvement,
} from '../../lib/phaseInvolvement';

// CRUD for per-phase partner involvement (PhasePartner). A partner either OWNS a
// program (Project.partnerId) or is INVOLVED in specific phases via these rows.
//
// Mirrors phasePeople field for field. The shared mutation boundary — the resolvers and
// the revalidation list — is lib/phaseInvolvement, which explains the split.

export async function addPhasePartner(formData: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const { phaseId, partnerId, projectId, role } = parseForm(phasePartnerAssignSchema, formData);

    await requirePhaseInProject(phaseId, projectId);
    await requirePartner(partnerId);

    await prisma.phasePartner.upsert({
      where: { phaseId_partnerId: { phaseId, partnerId } },
      update: { role },
      create: { phaseId, partnerId, role },
    });

    revalidateInvolvement(projectId);
    revalidatePath(`/partners/${partnerId}`);
  });
}

export async function removePhasePartner(formData: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const id = parseInvolvementLinkId(formData.get('id'));
    const projectId = parseInt(formData.get('projectId') as string, 10);

    const existing = await prisma.phasePartner.findUnique({ where: { id } });
    if (existing) {
      await prisma.phasePartner.delete({ where: { id } });
      revalidatePath(`/partners/${existing.partnerId}`);
    }
    revalidateInvolvement(projectId);
  });
}
