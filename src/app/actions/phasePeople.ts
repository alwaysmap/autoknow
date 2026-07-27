'use server';

import { revalidatePath } from 'next/cache';
import { parseForm, phasePersonAssignSchema } from '../../lib/schemas';
import { prisma } from '../../lib/db';
import { guarded, type ActionResult } from '../../lib/actionResult';
import {
  parseInvolvementLinkId, requirePerson, requirePhaseInProject, revalidateInvolvement,
} from '../../lib/phaseInvolvement';

// CRUD for per-phase people involvement (PhasePerson) — mirrors phasePartners,
// including its mutation boundary: the shape comes from the schema, the RESOLUTION
// (does this phase belong to this program, does this person exist) from
// lib/phaseInvolvement, which also owns the revalidation list both files share.

export async function addPhasePerson(formData: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const { phaseId, personId, projectId, role } = parseForm(phasePersonAssignSchema, formData);

    await requirePhaseInProject(phaseId, projectId);
    await requirePerson(personId);

    await prisma.phasePerson.upsert({
      where: { phaseId_personId: { phaseId, personId } },
      update: { role },
      create: { phaseId, personId, role },
    });

    revalidateInvolvement(projectId);
    revalidatePath(`/people/${personId}`);
  });
}

export async function removePhasePerson(formData: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const id = parseInvolvementLinkId(formData.get('id'));
    const projectId = parseInt(formData.get('projectId') as string, 10);

    const existing = await prisma.phasePerson.findUnique({ where: { id } });
    if (existing) {
      await prisma.phasePerson.delete({ where: { id } });
      revalidatePath(`/people/${existing.personId}`);
    }
    revalidateInvolvement(projectId);
  });
}
