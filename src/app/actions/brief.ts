'use server';

import { revalidatePath } from 'next/cache';
import { createProgramBrief } from '../../lib/brief';

// On-demand regeneration from the ProgramBrief card's button.
export async function regenerateBrief(formData: FormData) {
  const projectId = parseInt(formData.get('projectId') as string, 10);
  if (isNaN(projectId)) throw new Error('Invalid project ID');

  await createProgramBrief(projectId, 'manual');
  revalidatePath(`/programs/${projectId}`);
}
