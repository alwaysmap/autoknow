---
title: An out-of-disk CI runner fails as whatever test it happened to be running
status: current
updated: 2026-07-27
applies_to:
  - .github/workflows/ci.yml
  - scripts/ci/disk-guard.sh
  - scripts/ci/disk-report.sh
  - scripts/ci/disk-reclaim.sh
  - a red browser/e2e check you are about to re-run
symptoms:
  - one browser leg is red while every other job in the run is green
  - the step log simply stops, with no assertion and no stack
  - a job stuck `in_progress` with no conclusion, or `No space left on device` naming a path under `actions-runner/*/_diag/`
verified_by: 'runs 30239195026 and 30288543059 (attempt 1 webkit `failure`, everything else `success`); measurements in runs 30300083981, 30301180776, 30302815906 and 30304111252; PR #226'
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
2. **Measure before adding headroom — then keep measuring.** Two candidate fixes stay
   rejected on numbers: retained test artifacts are **584 KB**, and the engines already run
   on separate runners. An e2e leg starts with **14.1 GiB free** of 72 GiB (81% is the
   runner image) and costs ~2.2 GiB of files: `node_modules` 924 MB, browser payload
   295/646 MB, the `--with-deps` apt archive 221/132 MB, `.next-test` 93 MB.
3. **A fill is not growth, and on webkit it is not rare.** Low-water over runs 30300083981 /
   30301180776 / 30302815906: chromium 12.0 / 11.8 / 11.8 GiB, webkit **11.9 / 6.0 / 6.1**
   GiB — with every path above byte-for-byte normal on the low runs. **Set the warn line
   ABOVE where the leg actually sits:** 6 GiB was tried first and never fired, because webkit
   lands at 6.0-6.1. Any report below `CI_DISK_WARN_MB` escalates to a deep scan.
4. **The writer holds the space open rather than leaving it on disk.** Run 30304111252:
   webkit fell to **1.9 GiB (98% used)** — GitHub's own warning read "Free space left:
   31 MB" — and once the guard killed the suite the disk was back to **11.9 GiB**. ~10 GiB
   lived in unlinked-but-open files of the running processes, which no `du` can see. Peak
   ~10 GiB against ~12 GiB available is why this fails intermittently, and why
   `scripts/ci/disk-reclaim.sh` buys margin back. The writer itself is still unidentified.

**How we found out.** Nothing measured it, and nothing could afterwards: the job never
printed its free disk, and both failing job logs had expired from the Actions API (HTTP 404
`BlobNotFound`) within a day. For an infrastructure failure the evidence has to be printed
in-line while it happens, because the log you plan to read later may not be there.
