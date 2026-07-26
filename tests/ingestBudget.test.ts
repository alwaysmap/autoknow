// #38: the ingestion budget is ONE admin knob (docs/day) from which the per-cycle cap
// and the settings slider's free-tier line are both derived — as pure functions, so the
// UI a human reads and the cron that enforces the spend agree by construction. This
// proves the daily Gemini ceiling is bounded (perCycleBudget × cycles ≤ budget), that
// the free-tier crossover is computed honestly, and the divide-by-zero edges are safe.
import { readFileSync } from 'fs';
import path from 'path';
import {
  GEMINI_CALLS_PER_DOC,
  GEMINI_CALLS_PER_SUMMARY,
  perCycleBudget,
  perCycleRequests,
  summariesAffordable,
  estimatedRequestsPerDay,
  maxDocsPerDayUnderFreeTier,
  budgetGauge,
} from '../src/lib/ingestBudget';
import {
  DEFAULT_CYCLES_PER_DAY,
  cyclesPerDayOf,
  knownCyclesPerDay,
  resolveCyclesPerDay,
} from '../src/lib/cronCadence';

// The budget functions resolve the cadence from REFRESH_CRON_SCHEDULE on every call, so
// every assertion about the DEFAULT has to be made with the variable genuinely absent —
// otherwise a developer's .env (or a future one) silently rewrites what these prove. The
// override cases set it inside their own test, after this has cleared it.
const INHERITED_CRON = process.env.REFRESH_CRON_SCHEDULE;
beforeEach(() => {
  delete process.env.REFRESH_CRON_SCHEDULE;
});
afterAll(() => {
  if (INHERITED_CRON === undefined) delete process.env.REFRESH_CRON_SCHEDULE;
  else process.env.REFRESH_CRON_SCHEDULE = INHERITED_CRON;
});

describe('#38 ingestion budget math', () => {
  test('perCycleBudget floors so the daily total never exceeds the budget', () => {
    // 60 docs/day over 24 cycles = 2.5 → floor 2; 2 × 24 = 48 ≤ 60.
    expect(perCycleBudget(60)).toBe(2);
    expect(perCycleBudget(60) * DEFAULT_CYCLES_PER_DAY).toBeLessThanOrEqual(60);
    expect(perCycleBudget(240)).toBe(10);
    expect(perCycleBudget(240) * DEFAULT_CYCLES_PER_DAY).toBeLessThanOrEqual(240);
  });

  test('a small budget still makes at least 1 doc/cycle of progress', () => {
    expect(perCycleBudget(1)).toBe(1);
    expect(perCycleBudget(23)).toBe(1); // floors to 0 over 24 cycles; min-1 keeps it moving
  });

  test('a zero budget means OFF, not "1 doc/cycle anyway"', () => {
    // The min-1 floor used to apply here too, so the one setting whose intent is
    // unambiguous cost 48 requests/day while the slider beside it read 0.
    expect(perCycleBudget(0)).toBe(0);
    expect(perCycleRequests(0)).toBe(0);
    expect(summariesAffordable(perCycleRequests(0))).toBe(0);
    // Negatives clamp to zero, not to the min-1 floor.
    expect(perCycleBudget(-5)).toBe(0);
  });

  test('per-cycle budget tracks a non-default cadence', () => {
    expect(perCycleBudget(240, 48)).toBe(5); // every 30 min ⇒ 48 cycles
  });

  test('estimated requests/day is the ENFORCED ceiling, not the raw knob × calls-per-doc', () => {
    // It reports what the cron can actually spend: per-cycle allowance × cycles. The raw
    // product (100 × 2 = 200) over-states, because 100/24 floors to 4 docs a cycle.
    expect(estimatedRequestsPerDay(100)).toBe(4 * GEMINI_CALLS_PER_DOC * DEFAULT_CYCLES_PER_DAY);
    expect(estimatedRequestsPerDay(100)).toBe(192);
    expect(estimatedRequestsPerDay(0)).toBe(0);
    // …and the direction that matters: a sub-cycle budget rides the min-1 floor, so it
    // costs 48/day. The raw product said 2 — the under-report a quota guard cannot make.
    expect(estimatedRequestsPerDay(1)).toBe(48);
  });

  test('the plotted figure is exactly what a full day of cycles can spend', () => {
    for (const budget of [0, 1, 23, 24, 60, 100, 143, 240, 1000]) {
      expect(estimatedRequestsPerDay(budget)).toBe(perCycleRequests(budget) * DEFAULT_CYCLES_PER_DAY);
    }
  });

  test('maxDocsPerDayUnderFreeTier is the LAST budget in the safe band', () => {
    // 250/day funds floor(250 / (2 × 24)) = 5 docs a cycle; budgets 120..143 all floor to
    // 5, so the safe region ends at 143, not at the first budget that reaches the step.
    expect(maxDocsPerDayUnderFreeTier(250)).toBe(143);
    expect(estimatedRequestsPerDay(maxDocsPerDayUnderFreeTier(250))).toBeLessThanOrEqual(250);
    expect(estimatedRequestsPerDay(maxDocsPerDayUnderFreeTier(250) + 1)).toBeGreaterThan(250);
  });

  test('a free tier too small for even one doc per cycle has no safe budget', () => {
    expect(maxDocsPerDayUnderFreeTier(47)).toBe(0); // one doc/cycle already costs 48/day
    // At exactly 48 the tier funds one doc/cycle — which every budget from 1 (via the
    // min-1 floor) to 47 (via the 24-doc band) resolves to, so 47 is the last safe one.
    expect(maxDocsPerDayUnderFreeTier(48)).toBe(47);
    expect(estimatedRequestsPerDay(47)).toBe(48);
    expect(estimatedRequestsPerDay(48)).toBe(96);
  });

  test('budgetGauge reports the free-tier crossover honestly', () => {
    const safe = budgetGauge(60, 250);
    expect(safe.requestsPerDay).toBe(96);
    expect(safe.exceedsFreeTier).toBe(false);
    expect(safe.fractionOfFreeTier).toBeCloseTo(96 / 250);
    expect(safe.safeMaxDocsPerDay).toBe(143);

    const over = budgetGauge(200, 250);
    expect(over.requestsPerDay).toBe(384); // 8 docs/cycle × 2 × 24
    expect(over.exceedsFreeTier).toBe(true);
    expect(over.fractionOfFreeTier).toBeCloseTo(384 / 250);
  });

  test('the default 60/250 settings sit safely under the free tier', () => {
    // The shipped defaults must not put a fresh install over the line — and now that
    // claim covers summaries too, which is what it failed to do before.
    expect(budgetGauge(60, 250).exceedsFreeTier).toBe(false);
  });

  test('a zero free-tier ceiling never divides by zero', () => {
    const g = budgetGauge(60, 0);
    expect(g.fractionOfFreeTier).toBe(Infinity);
    expect(g.exceedsFreeTier).toBe(true);
    expect(g.safeMaxDocsPerDay).toBe(0);
  });
});

// The regression this file exists for. Ingestion and summaries once drew from separate
// pools — the budget bounded the first and the gauge plotted only the first, while
// runSummaryCycle spent up to 10/cycle beside it. At the shipped defaults that read as
// "120/day, 48% of the free tier" and cost up to 360/day. These prove the pool is one.
describe('one pool: ingestion and summaries share the cycle allowance', () => {
  test('the cycle allowance is the per-cycle doc cap priced in requests', () => {
    expect(perCycleRequests(60)).toBe(perCycleBudget(60) * GEMINI_CALLS_PER_DOC);
    expect(perCycleRequests(60)).toBe(4); // 2 docs/cycle × 2 calls
  });

  test('what ingestion leaves is what summaries may spend', () => {
    const allowance = perCycleRequests(240); // 10 docs/cycle ⇒ 20 requests
    expect(allowance).toBe(20);

    // A busy cycle: 8 docs (re)ingested ⇒ 16 requests gone, 4 summaries affordable.
    expect(summariesAffordable(allowance - 8 * GEMINI_CALLS_PER_DOC)).toBe(4);
    // A quiet cycle: unchanged docs short-circuit before Gemini, so summaries get it all.
    expect(summariesAffordable(allowance - 0)).toBe(20 / GEMINI_CALLS_PER_SUMMARY);
    // A cycle that spent the lot: summaries get nothing, and never a negative.
    expect(summariesAffordable(allowance - 10 * GEMINI_CALLS_PER_DOC)).toBe(0);
    expect(summariesAffordable(-6)).toBe(0);
  });

  test('total daily spend — ingestion AND summaries — stays under what the gauge plots', () => {
    for (const budget of [0, 1, 23, 60, 100, 240, 1000]) {
      const perCycle = perCycleRequests(budget);
      // Whatever the split between the two consumers, one cycle cannot exceed its
      // allowance: every request either ingested a doc or generated a summary.
      for (const docsIngested of [0, Math.floor(perCycleBudget(budget) / 2), perCycleBudget(budget)]) {
        const onIngest = docsIngested * GEMINI_CALLS_PER_DOC;
        const onSummaries = summariesAffordable(perCycle - onIngest) * GEMINI_CALLS_PER_SUMMARY;
        expect(onIngest + onSummaries).toBeLessThanOrEqual(perCycle);
      }
      expect(perCycle * DEFAULT_CYCLES_PER_DAY).toBe(estimatedRequestsPerDay(budget));
    }
  });

  test('the tally counts DISTILLED docs, not "changed" ones', () => {
    // Caught in review, and it is the original bug wearing a new coat. A doc whose digest
    // reads `resolved` calls summarizeDocument AND embedForStorage, then reports
    // result: 'frozen' (lib/refresh) — so it never appears in `changed`. Dividing the
    // shared allowance by `changed` would hand summaries a pool ingestion had already
    // spent, and in a cycle where every changed doc resolves it would hand over ALL of it.
    const allowance = perCycleRequests(240); // 10 docs/cycle ⇒ 20 requests
    const cycle = { changed: 0, frozen: 4, spent: 4 }; // four resolved docs: 8 requests gone

    const byChanged = summariesAffordable(allowance - cycle.changed * GEMINI_CALLS_PER_DOC);
    const bySpent = summariesAffordable(allowance - cycle.spent * GEMINI_CALLS_PER_DOC);

    expect(byChanged).toBe(20); // the whole pool, on top of the 8 already spent — the bug
    expect(bySpent).toBe(12); // what is actually left
    expect(cycle.spent * GEMINI_CALLS_PER_DOC + bySpent * GEMINI_CALLS_PER_SUMMARY)
      .toBeLessThanOrEqual(allowance);
  });

  test('the shipped defaults now really do sit under the free tier', () => {
    // 60 docs/day ⇒ 4 requests/cycle ⇒ 96/day, all consumers included, vs a 250 tier.
    expect(perCycleRequests(60) * DEFAULT_CYCLES_PER_DAY).toBe(96);
    expect(perCycleRequests(60) * DEFAULT_CYCLES_PER_DAY).toBeLessThanOrEqual(250);
    expect(budgetGauge(60, 250).exceedsFreeTier).toBe(false);
  });
});

// Cycles/day is the divisor under every cap, and it used to be a literal 24 — an
// ASSUMPTION about infrastructure that failed OPEN: run the cron twice as often and daily
// spend doubles while the slider keeps plotting the old ceiling. Terraform now exports the
// Scheduler cadence (REFRESH_CRON_SCHEDULE, #197), so the divisor is read rather than
// assumed. These cover the three states that exist — exported, absent, and exported as
// something no parser should guess at — and the Terraform-default guard stays, because the
// FALLBACK now depends on that default being what it claims.
describe('cycles/day is read from the exported Scheduler cadence', () => {
  const vars = readFileSync(
    path.join(__dirname, '..', 'infra', 'terraform', 'variables.tf'),
    'utf8',
  );

  it('parses the cadences this pipeline uses, and only those', () => {
    expect(cyclesPerDayOf('0 * * * *')).toBe(24);
    expect(cyclesPerDayOf('0 */2 * * *')).toBe(12);
    expect(cyclesPerDayOf('*/30 * * * *')).toBe(48);
    expect(cyclesPerDayOf('0 0,12 * * *')).toBe(2); // a list of hours
    expect(cyclesPerDayOf('0 9 * * 1')).toBeNull(); // weekly — re-derive by hand
    expect(cyclesPerDayOf('nonsense')).toBeNull();
    expect(cyclesPerDayOf('')).toBeNull();
    expect(cyclesPerDayOf('0 24 * * *')).toBeNull(); // hour 24 does not exist
    expect(cyclesPerDayOf('0 9-17 * * *')).toBeNull(); // ranges are not modelled
  });

  it('counts the fires a step makes, rather than dividing by it', () => {
    // A step of 5 over 24 hours fires at 0, 5, 10, 15, 20 — five cycles, not 24/5 = 4.8.
    // Dividing would UNDER-count cycles, which over-states what each one may spend.
    expect(cyclesPerDayOf('0 */5 * * *')).toBe(5);
    expect(cyclesPerDayOf('*/7 * * * *')).toBe(24 * 9); // 0,7,…,56 — nine an hour
  });

  it('matches the cron_schedule Terraform actually defaults to', () => {
    const match = vars.match(/variable\s+"cron_schedule"[\s\S]*?default\s*=\s*"([^"]+)"/);
    expect(match).not.toBeNull();

    const cron = (match as RegExpMatchArray)[1];
    const cycles = cyclesPerDayOf(cron);
    // A null here means the schedule changed to a shape this parser does not model: work
    // out the real cycles/day and teach cyclesPerDayOf the shape. The equality keeps the
    // FALLBACK honest — a deployment that predates the export gets this number.
    expect(cycles).not.toBeNull();
    expect(cycles).toBe(DEFAULT_CYCLES_PER_DAY);
  });

  it('falls back to the default when infrastructure said nothing', () => {
    // The config gate: infra lands first, the app second. A revision without the env var
    // — or any local checkout, which has no scheduler at all — still computes a budget.
    expect(knownCyclesPerDay()).toBeNull();
    expect(resolveCyclesPerDay()).toBe(DEFAULT_CYCLES_PER_DAY);
    expect(perCycleBudget(240)).toBe(10);
  });

  it('falls back safely when the schedule is present but unparseable', () => {
    for (const junk of ['every hour', '0 9 * * 1', '0 * * *', '   ']) {
      process.env.REFRESH_CRON_SCHEDULE = junk;
      expect(knownCyclesPerDay()).toBeNull(); // declared unknown, never guessed
      expect(resolveCyclesPerDay()).toBe(DEFAULT_CYCLES_PER_DAY);
      expect(perCycleBudget(240)).toBe(10);
    }
  });

  // THE GAP THE OLD TEST LEFT OPEN. It pinned the constant to the Terraform DEFAULT, so a
  // deployment that overrode `var.cron_schedule` sailed past a green suite and spent a
  // multiple of what the slider plotted. These drive the override end to end.
  it('an overridden half-hourly schedule halves what a cycle may spend', () => {
    process.env.REFRESH_CRON_SCHEDULE = '*/30 * * * *';
    expect(resolveCyclesPerDay()).toBe(48);
    // The same 240-doc budget, now spread over twice as many cycles: 5 a cycle, not 10.
    // Under the old literal the cron would have kept ingesting 10 — 480 requests/day
    // against a budget the admin set expecting 480 over 24 cycles. Same ceiling, twice
    // the cycles, double the spend.
    expect(perCycleBudget(240)).toBe(5);
    expect(perCycleRequests(240)).toBe(10);
    expect(estimatedRequestsPerDay(240)).toBe(480);
  });

  it('a ten-minute schedule changes what the gauge tells the admin is safe', () => {
    process.env.REFRESH_CRON_SCHEDULE = '*/10 * * * *';
    expect(resolveCyclesPerDay()).toBe(144);
    // The min-1 floor costs 1 doc × 2 calls × 144 cycles = 288/day, so a 250/day free tier
    // funds NO budget at all. The old literal plotted 143 docs/day as "safe" here while the
    // cron really spent 288+ — the gauge lying by a factor of six, silently.
    expect(estimatedRequestsPerDay(1)).toBe(288);
    expect(maxDocsPerDayUnderFreeTier(250)).toBe(0);
    expect(budgetGauge(60, 250).exceedsFreeTier).toBe(true);
    expect(budgetGauge(60, 250).safeMaxDocsPerDay).toBe(0);
  });

  it('an explicit cadence still wins over the environment', () => {
    // The client half of the settings page cannot read the env var, so the server passes
    // the resolved number down as a prop. That path has to keep working.
    process.env.REFRESH_CRON_SCHEDULE = '*/30 * * * *';
    expect(perCycleBudget(240, DEFAULT_CYCLES_PER_DAY)).toBe(10);
    expect(budgetGauge(60, 250, 12).requestsPerDay).toBe(120); // 5 docs/cycle × 2 × 12
  });
});

describe('#38 ingestion budget math (edges)', () => {
  test('a zero free-tier ceiling never divides by zero (gauge)', () => {
    const g = budgetGauge(60, 0);
    expect(g.fractionOfFreeTier).toBe(Infinity);
    expect(g.exceedsFreeTier).toBe(true);
    expect(g.safeMaxDocsPerDay).toBe(0);
  });
});
