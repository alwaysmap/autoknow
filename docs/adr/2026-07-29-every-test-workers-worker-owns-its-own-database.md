---
status: accepted
date: 2026-07-29
supersedes: ""
superseded-by: ""
extends: ""
extended-by: ""
tags: [testing, ci, database]
---

# A test worker owns its own database — in both runners, or it cannot be parallel

**Context.** jest ran `maxWorkers: 1` for one stated reason: ~28 suites wipe the ONE
`*_test` database, so concurrent workers clobber each other's fixtures. e2e had already
hit and solved exactly this — `tests/helpers/worktree` gives every Playwright worker its
own database and the server bound to it, which is the only reason `workers` may exceed 1.
The asymmetry was never a decision, only the order the two problems arrived in, and it
left the larger suite (~990 tests) serial while the smaller one parallelised.

**Decision.** A worker in either runner owns its own `*_test` database. The lane is
`{runner, index}`, named `_w<n>` for Playwright and `_j<n>` for jest, and
`testDatabaseUrl()` resolves the caller's own lane by default — from
`TEST_PARALLEL_INDEX` or `JEST_WORKER_ID` — so a suite needs no per-file wiring. The two
letters are load-bearing: both suites wipe what they are given and can run at once, so
without them worker 0 of each names one database and they eat each other's fixtures.

Each runner's worker count has exactly one home. jest's is `maxWorkers` in
`jest.config.ts`, and `tests/global-setup` provisions by reading that resolved count back
off jest's own `globalConfig` — not by recomputing it.

**Alternatives rejected.**

- *Leave jest serial and raise the timeout when it hurts.* That is what
  `testTimeout: 20_000` already was (autoknow-gj0), and it treats contention on a shared
  database as a budget problem. The measurement that closed this off: the nominal
  `wipeAll()` is ~5ms, so a 1000x excursion past a 5000ms hook budget was never round-trip
  count — see [note](../knowledge/truncate-is-far-slower-than-deletemany-on-small-test-tables.md).
- *A shared `jestWorkers()` constant, mirroring `e2eWorkers()`.* Impossible, not merely
  unattractive: jest transpiles its config alone, so a relative TypeScript import there
  fails to resolve at runtime. Reading the count back off `globalConfig` is strictly
  better anyway — the provisioner cannot disagree with what jest actually decided to run,
  whereas two constants can drift, and the drift's symptom is a worker landing on a
  database nobody created.
- *One database, wiped between files instead of within them.* Puts the fixtures of every
  suite in one namespace and makes any parallelism a correctness question forever.

**Consequences.** Both runners now leave per-worker databases behind
(`npm run db:test:clean` reclaims them, and already matched both schemes). The app-side
pool leak that `tests/close-app-pool.ts` closes is now per worker against one server-wide
`max_connections`, which makes that teardown more load-bearing, not less — measured peak
10 against a limit of 100 at four workers.

**It bought no CI time, and that is recorded on purpose.** `npm run test` measured 34s
against a 32–35s baseline. A GitHub runner has 4 vCPU shared with the Postgres service
container, so four jest workers oversubscribe it — the same effect already measured for
webkit, where `workers: 4` ran 32% SLOWER than 2. The local suite did get faster, and the
constraint is genuinely gone, but **do not redo this expecting a CI win**; the critical
path is e2e, not `quality`
([note](../knowledge/ci-wall-clock-is-one-job-find-it-before-optimizing.md)).

**Receipts.** PR #259 (`0b97448`); run 30416379550 (quality 153s, `npm run test` 34s, vs
159–162s / 32–35s on runs 30415271721 and 30415022112); AGENTS lesson 9.
