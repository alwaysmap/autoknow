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
  CYCLES_PER_DAY,
  perCycleBudget,
  perCycleRequests,
  summariesAffordable,
  estimatedRequestsPerDay,
  maxDocsPerDayUnderFreeTier,
  budgetGauge,
} from '../src/lib/ingestBudget';

describe('#38 ingestion budget math', () => {
  test('perCycleBudget floors so the daily total never exceeds the budget', () => {
    // 60 docs/day over 24 cycles = 2.5 → floor 2; 2 × 24 = 48 ≤ 60.
    expect(perCycleBudget(60)).toBe(2);
    expect(perCycleBudget(60) * CYCLES_PER_DAY).toBeLessThanOrEqual(60);
    expect(perCycleBudget(240)).toBe(10);
    expect(perCycleBudget(240) * CYCLES_PER_DAY).toBeLessThanOrEqual(240);
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
    expect(estimatedRequestsPerDay(100)).toBe(4 * GEMINI_CALLS_PER_DOC * CYCLES_PER_DAY);
    expect(estimatedRequestsPerDay(100)).toBe(192);
    expect(estimatedRequestsPerDay(0)).toBe(0);
    // …and the direction that matters: a sub-cycle budget rides the min-1 floor, so it
    // costs 48/day. The raw product said 2 — the under-report a quota guard cannot make.
    expect(estimatedRequestsPerDay(1)).toBe(48);
  });

  test('the plotted figure is exactly what a full day of cycles can spend', () => {
    for (const budget of [0, 1, 23, 24, 60, 100, 143, 240, 1000]) {
      expect(estimatedRequestsPerDay(budget)).toBe(perCycleRequests(budget) * CYCLES_PER_DAY);
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
      expect(perCycle * CYCLES_PER_DAY).toBe(estimatedRequestsPerDay(budget));
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
    expect(perCycleRequests(60) * CYCLES_PER_DAY).toBe(96);
    expect(perCycleRequests(60) * CYCLES_PER_DAY).toBeLessThanOrEqual(250);
    expect(budgetGauge(60, 250).exceedsFreeTier).toBe(false);
  });
});

// CYCLES_PER_DAY is the divisor under every cap, but Cloud Scheduler owns the real
// cadence and Terraform never hands it to the app — `cron_schedule` is set on the job and
// not exported to Cloud Run. So the constant is an ASSUMPTION about infrastructure, and an
// assumption that fails open: run the cron twice as often and daily spend doubles while
// the slider keeps plotting the old ceiling. That is the quota cap again, one line of HCL
// away. Until the schedule is exported and the constant can derive itself, this reads the
// Terraform and refuses to let the two drift apart quietly.
describe('CYCLES_PER_DAY tracks the Cloud Scheduler cron', () => {
  const vars = readFileSync(
    path.join(__dirname, '..', 'infra', 'terraform', 'variables.tf'),
    'utf8',
  );

  /** Cycles/day for the cron shapes this pipeline realistically uses. Anything else
   *  returns null ON PURPOSE — an unrecognized schedule is precisely the case where a
   *  human must re-derive the constant rather than have a parser guess for them. */
  function cyclesPerDayOf(cron: string): number | null {
    const fields = cron.trim().split(/\s+/);
    if (fields.length !== 5) return null;
    const [minute, hour, dom, month, dow] = fields;
    if (dom !== '*' || month !== '*' || dow !== '*') return null; // not a plain daily cadence

    if (/^\d+$/.test(minute) && hour === '*') return 24; // "0 * * * *" — hourly
    const everyNHours = hour.match(/^\*\/(\d+)$/);
    if (/^\d+$/.test(minute) && everyNHours) return 24 / Number(everyNHours[1]);
    const everyMMinutes = minute.match(/^\*\/(\d+)$/);
    if (everyMMinutes && hour === '*') return 1440 / Number(everyMMinutes[1]);
    return null;
  }

  it('parses the cadences this pipeline uses, and only those', () => {
    expect(cyclesPerDayOf('0 * * * *')).toBe(24);
    expect(cyclesPerDayOf('0 */2 * * *')).toBe(12);
    expect(cyclesPerDayOf('*/30 * * * *')).toBe(48);
    expect(cyclesPerDayOf('0 9 * * 1')).toBeNull(); // weekly — re-derive by hand
    expect(cyclesPerDayOf('nonsense')).toBeNull();
  });

  it('matches the cron_schedule Terraform actually defaults to', () => {
    const match = vars.match(/variable\s+"cron_schedule"[\s\S]*?default\s*=\s*"([^"]+)"/);
    expect(match).not.toBeNull();

    const cron = (match as RegExpMatchArray)[1];
    const cycles = cyclesPerDayOf(cron);
    // A null here means the schedule changed to a shape this test does not model: work out
    // the real cycles/day, set CYCLES_PER_DAY to it, and teach cyclesPerDayOf the shape.
    expect(cycles).not.toBeNull();
    expect(cycles).toBe(CYCLES_PER_DAY);
  });

  it('spells out what drift would cost, so the next reader does not have to model it', () => {
    // Same budget, twice the cycles: the enforced ceiling doubles while the gauge — which
    // reads CYCLES_PER_DAY — keeps reporting the old number.
    const plotted = estimatedRequestsPerDay(60); // uses CYCLES_PER_DAY = 24
    const ifCronRanTwiceAsOften = perCycleRequests(60, 24) * 48;
    expect(ifCronRanTwiceAsOften).toBe(plotted * 2);
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
