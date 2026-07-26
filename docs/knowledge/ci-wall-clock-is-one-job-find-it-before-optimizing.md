---
title: CI wall clock is ONE job's critical path — measure per-step before optimizing anything
status: current
updated: 2026-07-26
applies_to:
  - .github/workflows/ci.yml
  - playwright.config.ts
  - any "CI is too slow / too expensive" question
symptoms:
  - a PR takes ~6 minutes to go green and it feels like the tests are slow
  - you are about to speed up a job that is not on the critical path
  - runner-minute spend is rising and nobody knows which step causes it
verified_by: 'run 30186686741 (per-step timings via the Actions jobs API); playwright.config.ts:41 `workers: 1`; .github/workflows/ci.yml e2e matrix'
---

# CI wall clock is ONE job's critical path — measure per-step before optimizing anything

**The lesson.** The four CI jobs run in parallel, so **wall clock is the slowest single
job, not the sum**, while **spend is the sum**. Those two numbers point at different
fixes, and optimizing the wrong one feels productive and changes nothing. Get the real
per-step numbers first — one API call, no guessing:

```bash
RUN=$(gh run list --workflow=ci.yml --status completed --limit 1 --json databaseId -q '.[0].databaseId')
gh api repos/alwaysmap/autoknow/actions/runs/$RUN/jobs \
  -q '.jobs[] | "=== \(.name)", (.steps[] | select(.conclusion=="success") |
      "   \(.name): \((.completed_at|fromdateiso8601) - (.started_at|fromdateiso8601))s")'
```

**What that showed (run 30186686741), and why it was surprising.** Wall clock 5m43s,
spend ~10 runner-minutes:

| Job | Total | The cost inside it |
| --- | --- | --- |
| e2e | 5m43 | `playwright install --with-deps` **60s**, the test run **218s** |
| quality | 2m34 | `npm ci` 27s, lint 23s, build 36s, typecheck 16s, jest 19s |
| image | 1m36 | `docker build` 95s, no layer cache |
| migrations-lint | 4s | — |

Two things a reasonable person would have got wrong from the outside:

* **`--with-deps` cost 60s on a cache HIT.** The Playwright browser cache restored in 1s
  and then the step shelled out to `apt` anyway — the OS libs are not in the cached
  payload. Caching more browsers would have saved nothing.
* **`image` and `quality` are free in wall-clock terms.** Both finish long before e2e, so
  every second cut there is money only. Worth doing, but it is not the answer to "the PR
  takes six minutes".

**The ceiling nobody can cache away.** `playwright.config.ts` pins `workers: 1` because
every spec wipes the ONE shared test database in `beforeAll`. That, not tooling, is why
the suite is serial on a 4-vCPU runner. Sharding by browser across separate *runners*
works (each leg gets its own postgres service); raising `workers` inside a leg does not,
until each worker has its own database — bead `autoknow-7mb`.

**The rule.** Before touching a workflow, print the per-step table and decide which
number you are optimizing. If it is wall clock, you may only work on the job that IS the
critical path; anything else is spend. And re-measure after, because the critical path
moves — halve e2e and `quality` becomes the pole.
