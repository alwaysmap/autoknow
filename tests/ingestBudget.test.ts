// #38: the ingestion budget is ONE admin knob (docs/day) from which the per-cycle cap
// and the settings slider's free-tier line are both derived — as pure functions, so the
// UI a human reads and the cron that enforces the spend agree by construction. This
// proves the daily Gemini ceiling is bounded (perCycleBudget × cycles ≤ budget), that
// the free-tier crossover is computed honestly, and the divide-by-zero edges are safe.
import {
  GEMINI_CALLS_PER_DOC,
  CYCLES_PER_DAY,
  perCycleBudget,
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

  test('a small or zero budget still makes at least 1 doc/cycle of progress', () => {
    expect(perCycleBudget(0)).toBe(1);
    expect(perCycleBudget(1)).toBe(1);
    expect(perCycleBudget(-5)).toBe(1);
  });

  test('per-cycle budget tracks a non-default cadence', () => {
    expect(perCycleBudget(240, 48)).toBe(5); // every 30 min ⇒ 48 cycles
  });

  test('estimated requests/day is budget × calls-per-doc', () => {
    expect(estimatedRequestsPerDay(100)).toBe(100 * GEMINI_CALLS_PER_DOC);
    expect(estimatedRequestsPerDay(0)).toBe(0);
  });

  test('maxDocsPerDayUnderFreeTier is the budget where the free-tier line sits', () => {
    // 250 free-tier requests/day ÷ 2 calls/doc = 125 docs/day is the last safe budget.
    expect(maxDocsPerDayUnderFreeTier(250)).toBe(125);
    expect(estimatedRequestsPerDay(maxDocsPerDayUnderFreeTier(250))).toBeLessThanOrEqual(250);
    expect(estimatedRequestsPerDay(maxDocsPerDayUnderFreeTier(250) + 1)).toBeGreaterThan(250);
  });

  test('budgetGauge reports the free-tier crossover honestly', () => {
    const safe = budgetGauge(60, 250);
    expect(safe.requestsPerDay).toBe(120);
    expect(safe.exceedsFreeTier).toBe(false);
    expect(safe.fractionOfFreeTier).toBeCloseTo(120 / 250);
    expect(safe.safeMaxDocsPerDay).toBe(125);

    const over = budgetGauge(200, 250);
    expect(over.requestsPerDay).toBe(400);
    expect(over.exceedsFreeTier).toBe(true);
    expect(over.fractionOfFreeTier).toBeCloseTo(400 / 250);
  });

  test('the default 60/250 settings sit safely under the free tier', () => {
    // The shipped defaults must not put a fresh install over the line.
    expect(budgetGauge(60, 250).exceedsFreeTier).toBe(false);
  });

  test('a zero free-tier ceiling never divides by zero', () => {
    const g = budgetGauge(60, 0);
    expect(g.fractionOfFreeTier).toBe(Infinity);
    expect(g.exceedsFreeTier).toBe(true);
    expect(g.safeMaxDocsPerDay).toBe(0);
  });
});
