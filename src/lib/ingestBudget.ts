// The Gemini budget — one knob that keeps free-tier usage bounded and bill-safe (this
// deployment runs on the Gemini free tier; see #38 and
// [ADR: Ingestion health is a serverless signal, not a growing table]).
//
// The admin sets ONE number — `dailyReingestBudgetDocs` (documents (re)ingested per
// day). Everything else is derived here, as pure functions so the settings slider and
// the cron enforcement agree by construction and are unit-tested in isolation. The
// derived per-cycle cap bounds the daily Gemini spend WITHOUT a live meter: at most
// `perCycleBudget` docs are ingested each cycle, so at most `budget` docs — hence at
// most `budget × GEMINI_CALLS_PER_DOC` Gemini requests — per day.
//
// ONE POOL, NOT TWO. The budget used to cover ingestion only, while `runSummaryCycle`
// spent alongside it under a private cap of its own (10/cycle). Hourly, that was up to
// 240 requests/day the gauge could not see — on top of the 120 it drew as "48% of the
// free tier" — so the honest reading of a default install was ~360/day against a 250/day
// tier, and the first symptom was a real quota cap. So `perCycleRequests` is now the
// whole cycle's allowance in REQUESTS, and api/cron/refresh spends it in priority order:
// Drive discovery, then web refresh, then whatever summaries the remainder buys.
//
// Freshness outranks synthesis deliberately: a summary is derived from ingested content,
// so summarizing what we already have beats nothing, but ingesting new content beats
// re-summarizing stale content. The ordering is also self-balancing — on a quiet cycle
// ingestion spends ~0 (unchanged docs short-circuit before Gemini) and summaries inherit
// the entire allowance.
//
// SCOPE: this bounds the CRON — the unattended spender, and the only one that can drain a
// tier while nobody is looking. Human-initiated calls are deliberately outside it: a
// semantic search embeds its query (lib/search), a Regenerate click synthesizes one
// summary, a quick-ingest distills one document. Throttling those would mean refusing a
// user's explicit request to spend, which is a worse failure than the spend. They are
// bounded by how much a person can click, and the settings copy says so rather than
// letting the slider imply it covers them.

/**
 * Gemini requests a single (re)ingested document costs. Steady state (a changed doc)
 * is `summarizeDocument` (1 generateContent) + `embedForStorage` (1 embedContent) = 2.
 * First-time DISCOVERY adds one classify call (~3 total), but discovery is a one-time
 * cold-start cost; steady-state freshness — what the free-tier line must protect — is
 * refresh-dominated, so 2 is the honest nominal. Kept conservative and explicit rather
 * than hidden, because the free-tier marker the user reads is only as trustworthy as
 * this constant.
 */
export const GEMINI_CALLS_PER_DOC = 2;

/**
 * Gemini requests one generated summary costs: `generateStructuredSummary` is a single
 * generateContent call, whatever the scope. Evidence assembly is all database work.
 */
export const GEMINI_CALLS_PER_SUMMARY = 1;

/**
 * Hourly cron ⇒ 24 cycles/day, and the single most load-bearing number here: every cap
 * is a daily budget divided by it, so if the real schedule runs MORE often than this
 * claims, actual spend is a straight multiple of the ceiling the slider plots. Halving
 * `cron_schedule` to every 30 minutes would double daily spend in silence — the exact
 * failure that produced the quota cap, reachable through a one-line infra edit.
 *
 * Cloud Scheduler owns the real cadence and never tells the app (Terraform sets
 * `cron_schedule` on the job and does not export it to Cloud Run), so this constant
 * cannot derive itself. Until it can — see the infra issue to export the schedule —
 * `tests/ingestBudget.test.ts` parses the Terraform default and fails if the two
 * disagree, which turns silent drift into a red build.
 */
export const CYCLES_PER_DAY = 24;

/** How many documents one cron cycle may (re)ingest, given a daily budget. Floor so the
 *  daily total never exceeds the budget; min 1 so a small budget still makes progress.
 *
 *  Zero is the exception, and means OFF — spend nothing. It used to floor to 1 like any
 *  other small budget, which made the one setting whose intent is unambiguous ("stop
 *  spending") quietly cost 1 doc × 2 calls × 24 cycles = 48 requests/day while the
 *  slider beside it read 0. A budget the admin can't actually turn off is not a budget. */
export function perCycleBudget(dailyReingestBudgetDocs: number, cyclesPerDay = CYCLES_PER_DAY): number {
  const b = Math.max(0, Math.floor(dailyReingestBudgetDocs));
  if (b === 0) return 0;
  return Math.max(1, Math.floor(b / Math.max(1, cyclesPerDay)));
}

/**
 * The whole cycle's Gemini allowance, in REQUESTS — what api/cron/refresh divides across
 * Drive, web refresh and summaries. Denominated in requests rather than documents because
 * the three consumers cost different amounts per unit of work, and a single pool is the
 * only way the daily total stays bounded by one number.
 */
export function perCycleRequests(dailyReingestBudgetDocs: number, cyclesPerDay = CYCLES_PER_DAY): number {
  return perCycleBudget(dailyReingestBudgetDocs, cyclesPerDay) * GEMINI_CALLS_PER_DOC;
}

/** What N (re)ingested documents cost in requests. Trivial, and it lives here anyway:
 *  the module's contract is that every derivation is a tested pure function, and this is
 *  the one step the cron was doing inline — the step a review already caught wrong once. */
export function requestsForDocs(docs: number): number {
  return Math.max(0, Math.floor(docs)) * GEMINI_CALLS_PER_DOC;
}

/** How many summaries a leftover request allowance buys — the budget half of the summary
 *  cap (the other half is a latency bound; see MAX_SUMMARIES_PER_CYCLE in lib/summaries). */
export function summariesAffordable(requestsRemaining: number): number {
  return Math.max(0, Math.floor(requestsRemaining / GEMINI_CALLS_PER_SUMMARY));
}

/**
 * Gemini requests/day at a given budget — what the slider plots against the free-tier
 * line, and EXACTLY the ceiling the cron enforces for all consumers, because it is
 * derived from the same `perCycleRequests` the cycle spends from.
 *
 * It reads `budget × GEMINI_CALLS_PER_DOC` only when the budget divides evenly by the
 * cycle count. Elsewhere the per-cycle floor rounds it, so the honest figure comes from
 * the per-cycle allowance rather than from the raw knob:
 *
 *   • 60 docs/day floors to 2 docs/cycle ⇒ 96/day, not the 120 the raw product suggests.
 *   • 1..23 docs/day can't fill a cycle at all; the min-1 floor keeps them moving, so
 *     they really cost 48/day. The raw product said 2 — under-reporting, which is the
 *     one direction a quota guard must never round.
 *
 * The consequence is a staircase: budgets in the same 24-doc band plot the same figure.
 * That is a true property of an hourly cron with an integer per-cycle cap, and worth
 * showing rather than smoothing away.
 */
export function estimatedRequestsPerDay(
  dailyReingestBudgetDocs: number,
  cyclesPerDay = CYCLES_PER_DAY,
): number {
  return perCycleRequests(dailyReingestBudgetDocs, cyclesPerDay) * Math.max(1, cyclesPerDay);
}

/** The largest daily budget that still fits under a given free-tier requests/day ceiling
 *  — where the slider's "safe" region ends. Inverts the staircase above, landing on the
 *  LAST budget in the safe band rather than the first, so the marker sits where the
 *  region actually ends. */
export function maxDocsPerDayUnderFreeTier(
  freeTierRequestsPerDay: number,
  cyclesPerDay = CYCLES_PER_DAY,
): number {
  const cycles = Math.max(1, cyclesPerDay);
  const tier = Math.max(0, Math.floor(freeTierRequestsPerDay));
  const docsPerCycle = Math.floor(tier / (GEMINI_CALLS_PER_DOC * cycles));
  if (docsPerCycle === 0) return 0;
  return docsPerCycle * cycles + (cycles - 1);
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
  const requestsPerDay = estimatedRequestsPerDay(dailyReingestBudgetDocs, cyclesPerDay);
  const freeTier = Math.max(0, Math.floor(freeTierRequestsPerDay));
  return {
    dailyReingestBudgetDocs: Math.max(0, Math.floor(dailyReingestBudgetDocs)),
    requestsPerDay,
    freeTierRequestsPerDay: freeTier,
    fractionOfFreeTier: freeTier === 0 ? Infinity : requestsPerDay / freeTier,
    exceedsFreeTier: requestsPerDay > freeTier,
    safeMaxDocsPerDay: maxDocsPerDayUnderFreeTier(freeTier, cyclesPerDay),
    perCycleBudget: perCycleBudget(dailyReingestBudgetDocs, cyclesPerDay),
  };
}
