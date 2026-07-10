'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '../../lib/db';

// CRUD for per-phase partner involvement (PhasePartner). A partner either OWNS a
// program (Project.partnerId) or is INVOLVED in specific phases via these rows.

export async function addPhasePartner(formData: FormData) {
  const phaseId = parseInt(formData.get('phaseId') as string, 10);
  const partnerId = parseInt(formData.get('partnerId') as string, 10);
  const role = ((formData.get('role') as string) || '').trim() || null;
  const projectIdStr = formData.get('projectId') as string;

  if (isNaN(phaseId) || isNaN(partnerId)) throw new Error('Invalid phase or partner');

  await prisma.phasePartner.upsert({
    where: { phaseId_partnerId: { phaseId, partnerId } },
    update: { role },
    create: { phaseId, partnerId, role },
  });

  revalidatePath(`/projects/${projectIdStr}`);
  revalidatePath(`/partners/${partnerId}`);
}

export async function removePhasePartner(formData: FormData) {
  const id = parseInt(formData.get('id') as string, 10);
  const projectIdStr = formData.get('projectId') as string;

  if (isNaN(id)) throw new Error('Invalid involvement id');

  const existing = await prisma.phasePartner.findUnique({ where: { id } });
  if (existing) {
    await prisma.phasePartner.delete({ where: { id } });
    revalidatePath(`/partners/${existing.partnerId}`);
  }
  revalidatePath(`/projects/${projectIdStr}`);
}
