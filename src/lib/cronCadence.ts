// How often the refresh worker actually runs — a fact Cloud Scheduler owns and the app
// used to assume. Terraform now exports the job's `cron_schedule` to Cloud Run as
// REFRESH_CRON_SCHEDULE (infra/terraform/main.tf, #197), so the divisor under every
// Gemini cap can be READ instead of hardcoded.
//
// Why this matters more than a config nicety: `lib/ingestBudget` divides one daily
// budget by cycles/day. If the real schedule runs more often than the app believes,
// every cap is too generous by exactly that ratio and real spend is a straight multiple
// of the ceiling the settings slider plots — the quota cap of the budget ADR, reachable
// by editing one line of HCL. Halving `cron_schedule` to every 30 minutes would double
// daily spend in silence; at every 10 minutes it is 6×, and nothing in the app would say.
//
// ADR: docs/adr/2026-07-26-infra-owned-facts-are-supplied-or-unknown.md — an
// infrastructure-owned fact is supplied at runtime or declared unknown, never a literal.
// This module is the "supplied" half; `knownCyclesPerDay()` returning null is the
// "declared unknown" half, and user-facing copy branches on it rather than asserting a
// cadence no deployment promised. Reading this from a CLIENT component gets the fallback
// and no warning, which is its own trap:
// docs/knowledge/an-env-derived-default-is-the-fallback-inside-a-client-component.md

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
function fieldMatchCount(field: string, domainSize: number): number | null {
  if (field === '*') return domainSize;

  const step = /^\*\/(\d+)$/.exec(field);
  if (step) {
    const every = Number(step[1]);
    if (every < 1 || every > domainSize) return null;
    return Math.ceil(domainSize / every);
  }

  // A plain value, or a comma list of them ("0 0,12 * * *" — twice a day).
  if (/^\d+(,\d+)*$/.test(field)) {
    const values = new Set(field.split(',').map(Number));
    for (const v of values) if (v >= domainSize) return null;
    return values.size;
  }

  return null;
}

/**
 * Cycles per day for the cron shapes this pipeline realistically uses: the minute and
 * hour fields each accept `*`, a step, a value or a comma list, and day/month/weekday
 * must not narrow the schedule.
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
 *  environment held when the bundle first loaded. `cyclesPerDayOf` is the pure seam, so
 *  nothing here needs an injectable-schedule parameter to stay testable. */
function exportedCronSchedule(): string | null {
  return process.env.REFRESH_CRON_SCHEDULE?.trim() || null;
}

/**
 * The real cadence, or null when it is unknown — infrastructure said nothing, or said
 * something this parser will not guess at. Callers that must state a cadence to a human
 * branch on the null instead of substituting the default.
 */
export function knownCyclesPerDay(): number | null {
  const cron = exportedCronSchedule();
  return cron === null ? null : cyclesPerDayOf(cron);
}

/**
 * The cadence the budget math divides by: the exported one where it is knowable, the
 * documented fallback where it is not. Every default parameter in `lib/ingestBudget`
 * calls this, so a schedule change reaches every cap without anyone remembering to
 * pass it through.
 */
export function resolveCyclesPerDay(): number {
  return knownCyclesPerDay() ?? DEFAULT_CYCLES_PER_DAY;
}
