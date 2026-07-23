'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentUser } from '../../lib/session';
import { updateIngestionSettings } from '../../lib/ingestionSettings';

// #38: persist the ingestion budget from the Manage → Sources slider. The heavy lifting
// (clamping, defaults) lives in lib/ingestionSettings so it is unit-testable; this action
// is just the session-gated mutation boundary + a revalidate.

export async function updateIngestionBudgetAction(formData: FormData): Promise<void> {
  await getCurrentUser(); // session-gate the mutation (same domain gate as the rest of Manage)

  const budget = Number(formData.get('dailyReingestBudgetDocs'));
  const freeTier = Number(formData.get('freeTierRequestsPerDay'));
  const patch: { dailyReingestBudgetDocs?: number; freeTierRequestsPerDay?: number } = {};
  if (Number.isFinite(budget)) patch.dailyReingestBudgetDocs = budget;
  if (Number.isFinite(freeTier)) patch.freeTierRequestsPerDay = freeTier;

  await updateIngestionSettings(patch);
  revalidatePath('/manage/sources');
}
