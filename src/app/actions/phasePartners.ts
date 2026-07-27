'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '../../lib/db';
import { guarded, type ActionResult } from '../../lib/actionResult';
import {
  parseInvolvementLinkId, requirePartner, requirePhaseInProject, revalidateInvolvement,
} from '../../lib/phaseInvolvement';

// CRUD for per-phase partner involvement (PhasePartner). A partner either OWNS a
// program (Project.partnerId) or is INVOLVED in specific phases via these rows.
//
// Every id is resolved against a real row before anything is written, and every
// failure comes back as { error } rather than a throw: these run from an inline form
// inside an editor panel, and a thrown server action takes the whole surface to the
// route error boundary along with the user's input. The resolvers and the revalidation
// list are shared with phasePeople through lib/phaseInvolvement.

export async function addPhasePartner(formData: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const phaseId = parseInt(formData.get('phaseId') as string, 10);
    const partnerId = parseInt(formData.get('partnerId') as string, 10);
    const projectId = parseInt(formData.get('projectId') as string, 10);
    const role = ((formData.get('role') as string) || '').trim() || null;

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
