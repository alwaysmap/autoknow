'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '../../lib/db';
import { createSummary } from '../../lib/summaries';
import { geminiConfigured, isQuotaError } from '../../lib/gemini';
import { declineIfQuotaBlocked, quotaDeclineMessage } from '../../lib/geminiQuota';
import { isSummaryScope, DEFAULT_SUMMARY_PROMPTS, BRIEFING_SURVIVED } from '../../lib/summaryPrompts';
import type { ActionResult } from '../../lib/actionResult';

// Server actions for the leadership summaries: on-demand (re)generation from the
// panel, and prompt tuning from /manage/prompts.

/**
 * (Re)generate one scope's briefing. EVERY failure comes back as `{ error }` — this
 * action must not throw.
 *
 * It is not only the ✦ button: SummaryPanel fires it from a mount effect whenever the
 * cached briefing is missing or stale, so it runs unattended on ordinary page views of
 * /programs/:id, /partners/:id and /ecosystem. A throw there is not "the refresh
 * failed", it is the whole PAGE replaced by Next's error boundary — which is what a
 * Gemini spend cap did to /programs/3 in production (autoknow-6by): 429
 * RESOURCE_EXHAUSTED out of generateContent, straight through this action, into
 * global-error's "This page couldn't load".
 *
 * So it declines the same way its twin `POST /api/summaries/:scope/:id` does — ask the
 * quota latch BEFORE spending, and map anything that still escapes onto a sentence a
 * reader can act on. The cached briefing is untouched either way and stays readable.
 *
 * Not `guarded()` (lib/actionResult), though it returns that module's type: guarded's
 * fallback is "the change was not saved", and nothing here was being saved — the reader
 * needs to know their briefing is merely OLD, and whether the cap is why.
 */
export async function regenerateSummary(formData: FormData): Promise<ActionResult> {
  const scope = formData.get('scope') as string;
  const targetId = parseInt((formData.get('targetId') as string) || '0', 10);
  const path = (formData.get('path') as string) || '/';
  if (!isSummaryScope(scope) || isNaN(targetId)) return { error: 'Invalid scope' };
  // Defence in depth: SummaryPanel never reaches this — it renders the localized
  // "summaries are off" copy and no button — so this catches a deployment that lost its
  // key between the render and the click, and costs a wasted call rather than a throw.
  if (!geminiConfigured) {
    return { error: 'AI summaries are off — no GEMINI_API_KEY is configured.' };
  }

  const declined = declineIfQuotaBlocked('summary regenerate (action)', BRIEFING_SURVIVED);
  if (declined) return { error: declined };

  try {
    await createSummary(scope, targetId, 'manual');
  } catch (e) {
    console.error(`summary regeneration failed (${scope}/${targetId}):`, e);
    return {
      error: isQuotaError(e)
        ? quotaDeclineMessage(BRIEFING_SURVIVED)
        : 'The briefing could not be refreshed — the last one is unchanged.',
    };
  }
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

/** Drop a scope's override so it reverts to DEFAULT_SUMMARY_PROMPTS. */
export async function restoreDefaultPrompt(formData: FormData): Promise<void> {
  const scope = formData.get('scope') as string;
  if (!isSummaryScope(scope)) throw new Error('Invalid scope');
  await prisma.summaryPrompt.deleteMany({ where: { scope } });
  // Redirect (not just revalidate) so the uncontrolled textarea remounts showing the
  // default text — a plain re-render leaves the old value in the field.
  redirect('/manage/prompts');
}
