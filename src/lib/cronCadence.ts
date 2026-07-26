// How often the refresh worker actually runs — a fact Cloud Scheduler owns and the app
// used to assume. Terraform now exports the job's `cron_schedule` to Cloud Run as
// REFRESH_CRON_SCHEDULE (infra/terraform/main.tf, #197), so the divisor under every
// Gemini cap can be READ instead of hardcoded.
//
// Why this matters more than a config nicety: `lib/ingestBudget` divides one daily
// budget by cycles/day. If the real schedule runs more often than the app believes,
// every cap is too generous by exactly that ratio and real spend is a straight multiple
// of the ceiling the settings slider plots — the quota cap of the budget ADR, reachable
// by editing one line of HCL. Halving `cron_schedule` to every 30 minutes doubled daily
// spend in silence; at every 10 minutes it is 6×, and nothing in the app said so.
//
// ADR: docs/adr/2026-07-26-infra-owned-facts-are-supplied-or-unknown.md — an
// infrastructure-owned fact is supplied at runtime or declared unknown, never a literal.
// This module is the "supplied" half; `knownCyclesPerDay()` returning null is the
// "declared unknown" half, and user-facing copy branches on it rather than asserting a
// cadence no deployment promised.

/**
 * What to assume when infrastructure has not told us — a local checkout with no
 * scheduler at all, or a Cloud Run revision predating the export. It matches the
 * Terraform default (hourly), and `tests/ingestBudget.test.ts` fails if that stops
 * being true, so the fallback stays a plausible guess rather than folklore.
 *
 * The failure direction is worth stating: assuming MORE cycles than really run makes
 * every per-cycle cap smaller, so the app under-spends — safe. Assuming FEWER
 * over-spends. The fallback is therefore only dangerous against a genuinely sub-hourly
 * schedule, which is exactly the shape `cyclesPerDayOf` is built to recognize.
 */
export const DEFAULT_CYCLES_PER_DAY = 24;

// Values a single cron field matches, by counting rather than dividing — the distinction
// is not pedantry. A step of 5 on the hours field fires at 0, 5, 10, 15 and 20: FIVE
// times a day, not the 4.8 that 24/5 suggests. Rounding that down would under-count
// cycles, which is the one direction a spend guard must never round.
function fieldMatchCount(field: string, size: number): number | null {
  if (field === '*') return size;

  const step = /^\*\/(\d+)$/.exec(field);
  if (step) {
    const every = Number(step[1]);
    if (every < 1 || every > size) return null;
    return Math.ceil(size / every);
  }

  // A plain value, or a comma list of them ("0 0,12 * * *" — twice a day).
  if (/^\d+(,\d+)*$/.test(field)) {
    const values = new Set(field.split(',').map(Number));
    for (const v of values) if (v >= size) return null;
    return values.size;
  }

  return null;
}

/**
 * Cycles per day for the cron shapes this pipeline realistically uses — a fixed minute
 * or minute step, an hour wildcard, step or list, and no day/month/weekday narrowing.
 *
 * Anything else returns null ON PURPOSE. An unrecognized schedule is precisely the case
 * where a human must re-derive the number rather than have a parser guess on their
 * behalf: a wrong divisor here is invisible and expensive, while an honest "unknown"
 * costs one fallback that the caller can reason about.
 */
export function cyclesPerDayOf(cron: string): number | null {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return null;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  // A schedule that skips days is not a daily cadence, and averaging one into
  // "cycles per day" would report a fraction the budget math cannot honour.
  if (dayOfMonth !== '*' || month !== '*' || dayOfWeek !== '*') return null;

  const hours = fieldMatchCount(hour, 24);
  const minutes = fieldMatchCount(minute, 60);
  if (hours === null || minutes === null) return null;
  return hours * minutes;
}

/** The schedule infrastructure exported, or null where it did not. Read at CALL time,
 *  never captured at import: a module-level constant would freeze whatever the
 *  environment held when the bundle first loaded, and would be plain wrong in a client
 *  bundle, where this variable does not exist at all. */
function exportedCronSchedule(): string | null {
  if (typeof process === 'undefined') return null;
  const cron = process.env.REFRESH_CRON_SCHEDULE?.trim();
  return cron ? cron : null;
}

/**
 * The real cadence, or null when it is unknown — infrastructure said nothing, or said
 * something this parser will not guess at. Callers that must state a cadence to a human
 * branch on the null instead of substituting the default.
 */
export function knownCyclesPerDay(cron: string | null = exportedCronSchedule()): number | null {
  return cron === null ? null : cyclesPerDayOf(cron);
}

/**
 * The cadence the budget math divides by: the exported one where it is knowable, the
 * documented fallback where it is not. Every default parameter in `lib/ingestBudget`
 * calls this, so a schedule change reaches every cap without anyone remembering to
 * pass it through.
 */
export function resolveCyclesPerDay(cron: string | null = exportedCronSchedule()): number {
  return knownCyclesPerDay(cron) ?? DEFAULT_CYCLES_PER_DAY;
}
