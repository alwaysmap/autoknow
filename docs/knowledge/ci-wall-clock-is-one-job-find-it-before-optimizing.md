---
title: CI wall clock is ONE job's critical path, and a PR-scoped cache is one no PR reads
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
verified_by: 'run 30186686741 (per-step timings, Actions jobs API); PR #183 vs #184 (cache scoping); playwright.config.ts:41 `workers: 1`'
---

# CI wall clock is ONE job's critical path, and a PR-scoped cache is one no PR reads

## Measure per-step first — the guesses are wrong

Jobs run in parallel, so **wall clock is the slowest single job and spend is the sum**.
Those point at different fixes. One API call gets the truth:

```bash
RUN=$(gh run list --workflow=ci.yml --status completed --limit 1 --json databaseId -q '.[0].databaseId')
gh api repos/alwaysmap/autoknow/actions/runs/$RUN/jobs \
  -q '.jobs[] | "=== \(.name)", (.steps[] | select(.conclusion=="success") |
      "   \(.name): \((.completed_at|fromdateiso8601) - (.started_at|fromdateiso8601))s")'
```

Run 30186686741: e2e 5m43 (`--with-deps` **60s**, tests 218s), quality 2m34, image 1m36,
migrations-lint 4s. Two surprises: **`--with-deps` cost 60s on a cache HIT** (OS libs are
not in the cached browser payload, so caching more browsers saves nothing), and
`image`/`quality` finish so far ahead of e2e that work there is spend, not time.

## A cache only PRs write is a cache nobody reads

An Actions cache is readable only from the run's own ref **or the default branch**. With
`on: pull_request` alone, every cache lands on `refs/pull/<n>/merge` and the next PR
cannot see it — so `actions/cache` is decoration and *nothing warns you*:

```bash
gh api repos/<owner>/<repo>/actions/caches -q '.actions_caches[] | "\(.ref)  |  \(.key)"'
#   refs/pull/184/merge  |  node-modules-Linux-node22-5648ed48...   <- all on PR refs
```

Fix: a `push: branches: [main]` job that only writes those keys onto the default branch
(`warm-cache` in `ci.yml`) — not the whole gate suite, which would re-prove on main what
the PR just proved. **It fails silently both ways**: a wrong key or a drifted warm job
breaks no check, CI just goes cold again. Verify on the PR *after* the change — the one
that made it is cold by definition.

## The ceiling caching cannot lift

`playwright.config.ts` pins `workers: 1` because every spec wipes the ONE shared test DB
in `beforeAll` — that, not tooling, is why the suite is serial on 4 vCPUs. Sharding across
separate *runners* is safe (each leg gets its own postgres service); raising `workers`
needs per-worker databases first — bead `autoknow-7mb`.

**The rule.** Print the per-step table, decide whether you are buying wall clock or spend,
and re-measure after — halve e2e and `quality` becomes the pole.
