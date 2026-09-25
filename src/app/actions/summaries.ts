'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '../../lib/db';
import { isSummaryScope, DEFAULT_SUMMARY_PROMPTS } from '../../lib/summaryPrompts';

// Server actions for the leadership summaries: prompt tuning from /manage/prompts.
// (Re)generation is deliberately NOT here — it is `POST /api/summaries/:scope/:id`,
// because a server action is queued and holds the router until it returns, and a
// Gemini call is far too slow to hold the page hostage (see SummaryPanel).

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

/** Drop a scope's override so it reverts to DEFAULT_SUMMARY_PROMPTS. */
export async function restoreDefaultPrompt(formData: FormData): Promise<void> {
  const scope = formData.get('scope') as string;
  if (!isSummaryScope(scope)) throw new Error('Invalid scope');
  await prisma.summaryPrompt.deleteMany({ where: { scope } });
  // Redirect (not just revalidate) so the uncontrolled textarea remounts showing the
  // default text — a plain re-render leaves the old value in the field.
  redirect('/manage/prompts');
}
