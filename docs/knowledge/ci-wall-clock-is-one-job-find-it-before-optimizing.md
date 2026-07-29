---
title: CI wall clock is ONE job's critical path, and less than half of it may be tests
status: current
updated: 2026-07-29
applies_to:
  - .github/workflows/ci.yml
  - playwright.config.ts
  - jest.config.ts
  - any "CI is too slow / too expensive" question
symptoms:
  - a PR takes ~6 minutes to go green and it feels like the tests are slow
  - you are about to speed up a job that is not on the critical path
  - you are about to quote a duration you read in an ADR or a comment
  - you made a test suite parallel and CI did not get faster
verified_by: 'runs 30186686741 and the PR #186 run (per-step timings, Actions jobs API); autoknow-7mb (44.1s serial vs 39.1s on four workers, locally); run 30416379550 + PR #259 (the prose-figure inversion, and jest parallelism measuring zero on CI)'
---

# CI wall clock is ONE job's critical path, and less than half of it may be tests

Jobs run in parallel, so **wall clock is the slowest single job and spend is the sum** —
different fixes. Get the truth per step, never from intuition:

```bash
RUN=$(gh run list --workflow=ci.yml --status completed --limit 1 --json databaseId -q '.[0].databaseId')
gh api repos/alwaysmap/autoknow/actions/runs/$RUN/jobs \
  -q '.jobs[] | "=== \(.name)", (.steps[] | select(.conclusion=="success") |
      "   \(.name): \((.completed_at|fromdateiso8601) - (.started_at|fromdateiso8601))s")'
```

Run 30186686741: e2e 5m43 (`--with-deps` **60s**, tests 218s), quality 2m34, image 1m36,
migrations-lint 4s. Two surprises: `--with-deps` cost 60s **on a cache hit** (OS libs are
not in the cached browser payload), and `image`/`quality` finish so far ahead of e2e that
work there is spend, not time. **Sharding e2e by browser** was the only change that moved
wall clock (5m43 → ~4m10). Same shape a month later — run 30416379550: e2e webkit **348s**,
chromium 306s, quality 153s, image 114s — and on the pole leg **less than half the time is
tests** (suite 154s, disk reclaim 71s, `--with-deps` 52s, disk reports 28s). Check what
share of a leg is testing before optimising a test.

**A figure quoted in prose is not a measurement.** ADR `2026-07-20-premerge-quality-gate`
says the gate makes "PR feedback ~10 minutes" — the whole fan-out, NOT the `quality` job
this note has put at ~2m34 all along. Read as a job duration it inverts the ranking: a
session took `quality` for the pole, parallelised jest, and measured a **zero** CI win (34s
vs a 32–35s baseline — four workers oversubscribe a 4-vCPU runner already sharing it with
Postgres; [ADR](../adr/2026-07-29-every-test-workers-worker-owns-its-own-database.md)).
Records state decisions; only the jobs API states durations.

**Most cache wins are imaginary until measured**, and two shipped here that measured 0MB or
worse — that half of this note now lives in
[its own note](a-github-cache-lands-on-the-prs-own-ref-and-0mb-means-it-never-worked.md),
because "I added a cache and nothing happened" is a different moment from "CI is slow".

**Measure against the CURRENT shape.** `workers: 1` became 4 in `autoknow-7mb`; predicted
~4x, bought 44.1s → 39.1s, because browser sharding had already halved each leg and half of
what remains is `next build`. An estimate written before the PREVIOUS optimisation ships is
stale by the time you act on it.

**The rule.** Print the per-step table, decide whether you are buying wall clock or spend,
then re-measure — halve e2e and `quality` becomes the pole.
