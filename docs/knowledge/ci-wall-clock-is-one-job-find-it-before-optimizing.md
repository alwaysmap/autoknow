---
title: CI wall clock is ONE job's critical path, and most cache wins are imaginary until measured
status: current
updated: 2026-07-26
applies_to:
  - .github/workflows/ci.yml
  - playwright.config.ts
  - any "CI is too slow / too expensive" question
symptoms:
  - a PR takes ~6 minutes to go green and it feels like the tests are slow
  - you added actions/cache and nothing got faster, with no error anywhere
  - you are about to speed up a job that is not on the critical path
verified_by: 'runs 30186686741 and the PR #186 run (per-step timings, Actions jobs API); PR #183/#185/#187; autoknow-7mb (44.1s serial vs 39.1s on four workers, locally)'
---

# CI wall clock is ONE job's critical path, and most cache wins are imaginary until measured

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
work there is spend, not time. **Sharding e2e by browser** across runners was the only
change that moved wall clock (5m43 → ~4m10).

## Caches: check the ref, then check the size

A cache is readable only from the run's own ref **or the default branch**. With
`on: pull_request` alone every cache lands on `refs/pull/<n>/merge`, invisible to the next
PR — so `actions/cache` is decoration and *nothing warns you*. Fix: a `push: branches:
[main]` job that only writes the keys (`warm-cache`). Both checks:

```bash
gh api repos/<owner>/<repo>/actions/caches \
  -q '.actions_caches[] | "\(.ref)  \(.size_in_bytes/1048576|floor)MB  \(.key)"'
```

**`0MB` means it never worked.** Two that shipped and were reverted: `.next/cache` was empty
because `next.config.ts` enables **Turbopack**, which keeps no persistent cache there; and
buildx `type=gha` on the image job measured **96s → 113s, worse**, because the expensive
layer is `next build` inside the image, which every PR invalidates by definition. What paid:
`node_modules` (189MB, skips `npm ci`) and the browsers (261MB). Cache what is downloaded or
linked, never what the PR just changed — and verify on the PR *after*, since yours is cold.

**Measure against the CURRENT shape.** `workers: 1` (one shared test DB) became 4 in
`autoknow-7mb` — a DB and a server per worker. Predicted ~4x, bought 44.1s → 39.1s: browser
sharding had already halved what was left per leg, half of each leg is `next build`, and
per-test time inflates under contention. An estimate written before the PREVIOUS
optimisation ships is stale by the time you act on it.

**The rule.** Print the per-step table, decide whether you are buying wall clock or spend,
then re-measure — halve e2e and `quality` becomes the pole.
