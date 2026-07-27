---
title: An out-of-disk CI runner fails as whatever test it happened to be running
status: current
updated: 2026-07-27
applies_to:
  - .github/workflows/ci.yml
  - scripts/ci/disk-guard.sh
  - scripts/ci/disk-report.sh
  - a red browser/e2e check you are about to re-run
symptoms:
  - one browser leg is red while every other job in the run is green
  - the step log simply stops, with no assertion and no stack
  - a job stuck `in_progress` with no conclusion, or `No space left on device` naming a path under `actions-runner/*/_diag/`
verified_by: 'runs 30239195026 and 30288543059 (attempt 1 webkit `failure`, everything else `success`); measurements in runs 30300083981 and 30301180776; PR #226'
---

# An out-of-disk CI runner fails as whatever test it happened to be running

**The lesson.** When a GitHub runner fills its disk, the runner process dies — and GitHub
can only render that as a red check on **the step it was executing**. Here that is
`e2e (playwright · webkit)`, which is indistinguishable at a glance from a real webkit
flake. The reflex is to re-run, the re-run passes, and the incident leaves no trace. This
happened twice on 2026-07-27 and both runs were re-run into green (`run_attempt: 2` on
both). **Treat a red browser leg whose log just stops — no assertion, no stack — as an
infrastructure failure until the disk numbers say otherwise.**

**Why it bites.** The runner writes its own diagnostic log to the same disk the job fills,
so ENOSPC kills the process that reports results. Nothing after it runs: not the next step,
not an `if: always()` step, not a post-job hook. A `df` before and after therefore captures
only the "before" — the failure is structurally incapable of describing itself, which is
why it borrows the identity of the test underneath it.

**What to do.**

1. **Read the `DISK` lines the e2e job now prints** (`scripts/ci/disk-report.sh` at three
   points, plus the low-water mark from `scripts/ci/disk-guard.sh`). If the guard tripped,
   the failure says so and carries a filesystem breakdown taken at the moment of the fill.
2. **Do not add headroom without measuring.** The obvious fixes — reclaiming the runner's
   preinstalled toolchains, dropping test artifacts, splitting the browser engines — were
   all unnecessary here, and the first costs wall clock on the measured critical path (see
   [ci-wall-clock-is-one-job-find-it-before-optimizing](ci-wall-clock-is-one-job-find-it-before-optimizing.md)).
   Measured on run 30300083981, an e2e leg starts with **14.1 GiB free** on a 72 GiB disk
   (81% already used by the image) and its low-water mark is **11.9 GiB**: the whole job
   costs ~2.2 GiB — `node_modules` 924 MB, the browser payload 295 MB (webkit) / 646 MB
   (chromium), the apt archive `--with-deps` fills 221 MB / 132 MB, `.next-test` 93 MB. The
   retained Playwright artifacts everyone suspects are **584 KB**.
3. **So a fill is an anomaly, not growth.** Confirmed on the very next run (30301180776):
   the same webkit leg bottomed out at **6.0 GiB** and ended at 5.9 GiB / 92% used, while
   every path in the list above was byte-for-byte what it is on a healthy run. ~6 GiB went
   somewhere a targeted `du` does not look. Chase the writer with the deep scan — any report
   taken below `CI_DISK_WARN_MB` escalates to one automatically — not with the budget.

**How we found out.** Nothing measured it and nothing could afterwards: the job never
printed its free disk, and both failing job logs had already expired from the Actions API
(HTTP 404 `BlobNotFound`) within a day. That is the second lesson — for an infrastructure
failure, the evidence has to be printed in-line while it happens, because the log you plan
to read later may not be there.
