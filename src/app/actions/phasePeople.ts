'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '../../lib/db';

// CRUD for per-phase people involvement (PhasePerson) — mirrors phasePartners.

export async function addPhasePerson(formData: FormData) {
  const phaseId = parseInt(formData.get('phaseId') as string, 10);
  const personId = parseInt(formData.get('personId') as string, 10);
  const role = ((formData.get('role') as string) || '').trim() || null;
  const projectIdStr = formData.get('projectId') as string;

  if (isNaN(phaseId) || isNaN(personId)) throw new Error('Invalid phase or person');

  await prisma.phasePerson.upsert({
    where: { phaseId_personId: { phaseId, personId } },
    update: { role },
    create: { phaseId, personId, role },
  });

  revalidatePath(`/projects/${projectIdStr}`);
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
  revalidatePath(`/projects/${projectIdStr}`);
}
