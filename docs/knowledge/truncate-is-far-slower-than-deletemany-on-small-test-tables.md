---
title: TRUNCATE is ~30x SLOWER than deleteMany on the test database, because the tables are empty
status: current
updated: 2026-07-28
applies_to:
  - tests/helpers/fixtures.ts
  - any "the wipe is N round trips, collapse it into one statement" idea
symptoms:
  - the whole jest suite got 2-3x slower and every test still passes
  - you replaced a loop of deleteMany with one TRUNCATE and wall clock went UP
  - you are about to optimize wipeAll() because 26 round trips "must" be the cost
verified_by: 'micro-benchmark over 60 wipes in 3 alternating rounds against the real *_test DB (tests/helpers/db): sequential deleteMany 4.9ms/wipe, TRUNCATE CASCADE 146.3ms/wipe, $transaction([...deleteMany]) 5.5ms/wipe; full-suite confirmation 110.7s and 143.6s vs a 45-60s baseline'
---

# TRUNCATE is ~30x SLOWER than deleteMany on the test database, because the tables are empty

`fixtures.wipeAll()` issues one `deleteMany()` per model — 26 sequential round trips — and
~28 suites call it, 13 of them from `beforeEach`. That reads like an obvious win: collapse
it into a single `TRUNCATE TABLE "A", "B", … CASCADE` and pay one round trip instead of 26.

**Measured, it is 30x worse.** Alternating the strategies so a load spike hits each equally:

| strategy | per wipe |
|---|---|
| 26 sequential `deleteMany()` (what main does) | **4.9ms** |
| one `TRUNCATE … CASCADE` | **146.3ms** |
| `$transaction([...deleteMany])` — one batched round trip | 5.5ms |

At suite level that is 110.7s and 143.6s against a 45–60s baseline, which is just
~400 wipes × 146ms showing up where you would expect it.

**The premise is what is wrong, not the arithmetic.** 26 round trips against localhost
over tables holding a handful of fixture rows cost ~5ms in TOTAL. There is no latency
problem to solve. TRUNCATE, meanwhile, has a fixed per-table price that has nothing to do
with row count — it allocates a new file node, updates catalogs, and fsyncs — so it is
*faster than DELETE only once a table is big enough for the row-by-row work to dominate*.
A `*_test` database is the opposite regime: 26 nearly-empty tables is the worst possible
case for TRUNCATE and the best possible case for DELETE.

Note the batched `$transaction` variant is not an improvement either (5.5ms vs 4.9ms).
That is the same finding from the other side: if collapsing 26 round trips into one buys
nothing, the round trips were never the cost.

## What this means for the timeout that started it

`jest.config.ts` raised `testTimeout` from 5000ms to 20_000ms because `wipeAll()` in a
`beforeAll` blew the default hook budget under full-suite load (autoknow-gj0). Since the
nominal wipe is ~5ms, that 1000x excursion cannot have been round-trip COUNT. It was
contention on the ONE shared test database every suite was wiping — which is what
per-worker databases address, not a cheaper wipe.

**So: leave `wipeAll()` alone.** It is not a bottleneck, and the 13 `beforeEach` callers
that look wasteful are not worth converting either — several assert absolute row counts
and genuinely need a clean slate per test (`tests/refreshCycle.test.ts`,
`tests/driveSync.test.ts` say so in place).
