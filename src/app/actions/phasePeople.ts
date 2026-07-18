'use server';

import { revalidatePath } from 'next/cache';
import { parseForm, phaseAssignSchema } from '../../lib/schemas';
import { prisma } from '../../lib/db';

// CRUD for per-phase people involvement (PhasePerson) — mirrors phasePartners.

export async function addPhasePerson(formData: FormData) {
  const { phaseId, personId, projectId, role } = parseForm(phaseAssignSchema, formData);
  const projectIdStr = String(projectId);

  await prisma.phasePerson.upsert({
    where: { phaseId_personId: { phaseId, personId } },
    update: { role },
    create: { phaseId, personId, role },
  });

  revalidatePath(`/programs/${projectIdStr}`);
  revalidatePath(`/people/${personId}`);
}

export async function removePhasePerson(formData: FormData) {
  const id = parseInt(formData.get('id') as string, 10);
  const projectIdStr = formData.get('projectId') as string;

  if (isNaN(id)) throw new Error('Invalid involvement id');

  const existing = await prisma.phasePerson.findUnique({ where: { id } });
  if (existing) {
    await prisma.phasePerson.delete({ where: { id } });
    revalidatePath(`/people/${existing.personId}`);
  }
  revalidatePath(`/programs/${projectIdStr}`);
}
