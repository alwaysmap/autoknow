import 'server-only';
import { prisma } from './db';

// The ingestion budget setting (#38) — a singleton row (key = "default", like
// SummaryPrompt). Read by the cron to derive its per-cycle cap (lib/ingestBudget) and by
// the Manage → Sources settings slider; written only by an admin through that slider. The
// defaults come from the schema, so a fresh install already sits safely under the free
// tier without anyone touching this.

const KEY = 'default';

export interface IngestionSettingsValues {
  dailyReingestBudgetDocs: number;
  freeTierRequestsPerDay: number;
}

/** Read the budget setting, materializing the schema defaults on first use so callers
 *  never handle a null. */
export async function getIngestionSettings(): Promise<IngestionSettingsValues> {
  const row = await prisma.ingestionSettings.upsert({
    where: { key: KEY },
    update: {},
    create: { key: KEY },
    select: { dailyReingestBudgetDocs: true, freeTierRequestsPerDay: true },
  });
  return row;
}

/** Update the budget setting (admin action). Values are clamped to sane bounds at the
 *  mutation boundary so a slider bug or a hand-crafted request can't store a negative or
 *  absurd budget that the cron would then act on. */
export async function updateIngestionSettings(
  patch: Partial<IngestionSettingsValues>,
): Promise<IngestionSettingsValues> {
  const clamp = (n: number, lo: number, hi: number) =>
    Math.min(hi, Math.max(lo, Math.round(n)));
  const data: Partial<IngestionSettingsValues> = {};
  if (patch.dailyReingestBudgetDocs !== undefined) {
    data.dailyReingestBudgetDocs = clamp(patch.dailyReingestBudgetDocs, 0, 100_000);
  }
  if (patch.freeTierRequestsPerDay !== undefined) {
    data.freeTierRequestsPerDay = clamp(patch.freeTierRequestsPerDay, 0, 10_000_000);
  }
  const row = await prisma.ingestionSettings.upsert({
    where: { key: KEY },
    update: data,
    create: { key: KEY, ...data },
    select: { dailyReingestBudgetDocs: true, freeTierRequestsPerDay: true },
  });
  return row;
}
