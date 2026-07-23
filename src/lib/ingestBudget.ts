// The ingestion budget — one knob that keeps free-tier Gemini usage bounded and
// bill-safe (this deployment runs on the Gemini free tier; see #38 and
// [ADR: Ingestion health is a serverless signal, not a growing table]).
//
// The admin sets ONE number — `dailyReingestBudgetDocs` (documents (re)ingested per
// day). Everything else is derived here, as pure functions so the settings slider and
// the cron enforcement agree by construction and are unit-tested in isolation. The
// derived per-cycle cap bounds the daily Gemini spend WITHOUT a live meter: at most
// `perCycleBudget` docs are ingested each cycle, so at most `budget` docs — hence at
// most `budget × GEMINI_CALLS_PER_DOC` Gemini requests — per day.

/**
 * Gemini requests a single (re)ingested document costs. Steady state (a changed doc)
 * is `summarizeDocument` (1 generateContent) + `embedText` (1 embedContent) = 2.
 * First-time DISCOVERY adds one classify call (~3 total), but discovery is a one-time
 * cold-start cost; steady-state freshness — what the free-tier line must protect — is
 * refresh-dominated, so 2 is the honest nominal. Kept conservative and explicit rather
 * than hidden, because the free-tier marker the user reads is only as trustworthy as
 * this constant.
 */
export const GEMINI_CALLS_PER_DOC = 2;

/** Hourly cron ⇒ 24 cycles/day. Passed explicitly so it can track the real cadence
 *  (the Cloud Scheduler `cron_schedule` Terraform var) instead of drifting from it. */
export const CYCLES_PER_DAY = 24;

/** How many documents one cron cycle may (re)ingest, given a daily budget. Floor so the
 *  daily total never exceeds the budget; min 1 so a small budget still makes progress. */
export function perCycleBudget(dailyReingestBudgetDocs: number, cyclesPerDay = CYCLES_PER_DAY): number {
  const b = Math.max(0, Math.floor(dailyReingestBudgetDocs));
  return Math.max(1, Math.floor(b / Math.max(1, cyclesPerDay)));
}

/** Estimated Gemini requests/day at a given budget — what the slider plots against the
 *  free-tier line. */
export function estimatedRequestsPerDay(dailyReingestBudgetDocs: number): number {
  return Math.max(0, Math.floor(dailyReingestBudgetDocs)) * GEMINI_CALLS_PER_DOC;
}

/** The largest daily budget that still fits under a given free-tier requests/day ceiling
 *  — where the slider's "safe" region ends. */
export function maxDocsPerDayUnderFreeTier(freeTierRequestsPerDay: number): number {
  return Math.max(0, Math.floor(freeTierRequestsPerDay / GEMINI_CALLS_PER_DOC));
}

export interface BudgetGauge {
  dailyReingestBudgetDocs: number;
  requestsPerDay: number;
  freeTierRequestsPerDay: number;
  /** requestsPerDay / freeTierRequestsPerDay, clamped to [0, ∞) — the slider fill. */
  fractionOfFreeTier: number;
  /** True once the budget's estimated requests/day passes the free-tier ceiling. */
  exceedsFreeTier: boolean;
  /** The budget (docs/day) at which the free-tier line sits — the slider marker. */
  safeMaxDocsPerDay: number;
  perCycleBudget: number;
}

/** Everything the settings slider needs to render "here is where you pass the free tier",
 *  from the two stored settings. Pure — the same math the cron enforces. */
export function budgetGauge(
  dailyReingestBudgetDocs: number,
  freeTierRequestsPerDay: number,
  cyclesPerDay = CYCLES_PER_DAY,
): BudgetGauge {
  const requestsPerDay = estimatedRequestsPerDay(dailyReingestBudgetDocs);
  const freeTier = Math.max(0, Math.floor(freeTierRequestsPerDay));
  return {
    dailyReingestBudgetDocs: Math.max(0, Math.floor(dailyReingestBudgetDocs)),
    requestsPerDay,
    freeTierRequestsPerDay: freeTier,
    fractionOfFreeTier: freeTier === 0 ? Infinity : requestsPerDay / freeTier,
    exceedsFreeTier: requestsPerDay > freeTier,
    safeMaxDocsPerDay: maxDocsPerDayUnderFreeTier(freeTier),
    perCycleBudget: perCycleBudget(dailyReingestBudgetDocs, cyclesPerDay),
  };
}
