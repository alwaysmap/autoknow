---
title: A GitHub cache is readable only from its own ref or the default branch, and 0MB means it never worked
status: current
updated: 2026-07-29
applies_to:
  - .github/workflows/ci.yml
  - any actions/cache step, or a plan to add one
symptoms:
  - you added actions/cache and nothing got faster, with no error anywhere
  - a cache step reports a miss on every PR even though it ran last time
  - you are about to cache a build output to speed up CI
verified_by: 'PR #183/#185/#187 (warm-cache); the reverted .next/cache and buildx type=gha attempts; PR #184 (npm ci still 21s against an hour-old cache from PR #183)'
---

# A GitHub cache is readable only from its own ref or the default branch, and 0MB means it never worked

**The lesson.** A cache written by a `pull_request` run lands on `refs/pull/<n>/merge` and
is invisible to every other PR. With `on: pull_request` alone, `actions/cache` is
decoration — it writes, it never reads, and *nothing warns you*. The fix is a job on the
default branch whose only purpose is to write the keys PRs will read (`warm-cache` in
`ci.yml`). Separately: a cache that exists can still be worthless, and its SIZE is how you
tell.

**Why it bites.** The cache action reports a miss identically whether the key is wrong,
the ref is unreachable, or the payload is empty, so all three failures look like "cold
cache, it'll warm up next run" — forever. Measured on PR #184: `npm ci` still cost 21s
against a cache PR #183 had populated an hour earlier, because that cache was on a PR ref.

**What to do.** Check the ref and the size before believing a cache works:

```bash
gh api repos/<owner>/<repo>/actions/caches \
  -q '.actions_caches[] | "\(.ref)  \(.size_in_bytes/1048576|floor)MB  \(.key)"'
```

**`0MB` means it never worked.** Two shipped here and were reverted: `.next/cache` was
empty because `next.config.ts` enables **Turbopack**, which keeps no persistent cache
there; and buildx `type=gha` on the `image` job measured **96s → 113s, worse**, because the
expensive layer is `next build` inside the image, which every PR invalidates by definition.
What paid: `node_modules` (189MB, skips `npm ci`) and the Playwright browsers (261MB).

Cache what is **downloaded or linked**, never what the PR just changed. And verify on the
PR *after* the one that adds it — yours is cold by construction, so a green run on your own
PR proves nothing.

**Whether it is worth caching at all** is a different question, answered by
[the critical-path note](ci-wall-clock-is-one-job-find-it-before-optimizing.md): a cache on
a job that is not the pole buys spend, not wall clock.
