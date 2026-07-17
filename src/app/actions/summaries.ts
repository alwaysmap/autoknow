'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '../../lib/db';
import { createSummary } from '../../lib/summaries';
import { isSummaryScope, DEFAULT_SUMMARY_PROMPTS } from '../../lib/summaryPrompts';

// Server actions for the leadership summaries: on-demand (re)generation from the
// panel, and prompt tuning from /manage/prompts.

export async function regenerateSummary(formData: FormData): Promise<{ error?: string }> {
  const scope = formData.get('scope') as string;
  const targetId = parseInt((formData.get('targetId') as string) || '0', 10);
  const path = (formData.get('path') as string) || '/';
  if (!isSummaryScope(scope) || isNaN(targetId)) return { error: 'Invalid scope' };

  await createSummary(scope, targetId, 'manual');
  revalidatePath(path);
  return {};
}

export async function saveSummaryPrompt(formData: FormData): Promise<void> {
  const scope = formData.get('scope') as string;
  const prompt = ((formData.get('prompt') as string) || '').trim();
  if (!isSummaryScope(scope)) throw new Error('Invalid scope');

  if (!prompt || prompt === DEFAULT_SUMMARY_PROMPTS[scope].trim()) {
    // Empty (or unchanged-from-default) means "use the default" — drop the override.
    await prisma.summaryPrompt.deleteMany({ where: { scope } });
  } else {
    await prisma.summaryPrompt.upsert({
      where: { scope },
      create: { scope, prompt },
      update: { prompt },
    });
  }
  revalidatePath('/manage/prompts');
}
