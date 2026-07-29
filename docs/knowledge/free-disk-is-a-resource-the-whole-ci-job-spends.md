---
title: Free disk is a resource the whole CI job spends, not a threshold it clears once — reclaiming it is FASTER
status: current
updated: 2026-07-29
applies_to:
  - scripts/ci/disk-reclaim.sh
  - .github/workflows/ci.yml
  - any CI step that costs ~60s, asserts nothing, and looks like pure overhead
symptoms:
  - the test suite got slower and nothing about the tests changed
  - a disk probe that used to cost 14s suddenly costs 197s
  - you are about to skip or gate a cleanup step because the runner "has enough room"
  - CI is slow and the non-test steps look like the obvious thing to cut
verified_by: 'PR #261 — run 30417428911 (reclaim skipped) against 30416379550 (baseline): webkit 348s -> 471s, suite 154s -> 204s, job-end probe 14s -> 197s, guard low-water 32.1 GiB -> 5.8 GiB'
---

# Free disk is a resource the whole CI job spends, not a threshold it clears once — reclaiming it is FASTER

**The lesson.** `ci:disk-reclaim` deletes ~24 GiB of unused toolchains and costs 51-71s on
the e2e leg that IS the workflow's critical path. It looks like the definition of
removable: no assertions, a minute of pure setup, and the job demonstrably needs only ~7
GiB of headroom against the 14.1 GiB a runner arrives with. It was gated on exactly that
reasoning. **The leg went from 348s to 471s.**

**Why it bites.** Free space is not a line the job crosses once and forgets. Three separate
things degrade as it runs out, and none of them is the out-of-disk failure the machinery
was originally built for:

| | with reclaim | skipped |
|---|---|---|
| the reclaim step | 71s | **0s** — saved, as intended |
| the suite itself | 154s | **204s** — slower on a fuller filesystem |
| "Disk at job end" probe | 14s | **197s** — escalated itself to a `--deep` scan |
| guard low-water | 32.1 GiB | 5.8 GiB (and it warned, correctly) |

Net ~120s worse. The suite slows down because a nearly-full filesystem is slower to write
to, and the probes get expensive because low disk is exactly when they escalate to
attributing the fill. Buying headroom is what keeps every other step on its cheap path.

**What to do.** Judge a cleanup step by what the job costs WITH and WITHOUT it, never by
whether the remaining space clears a floor. The guard prints the low-water mark on every
run, pass or fail — that number, and the per-step table
([note](ci-wall-clock-is-one-job-find-it-before-optimizing.md)), are the whole input.

**The corollary, and it paid.** What was worth questioning is the SIZE of the reclaim, not
its existence — and the same discipline answered it. Per path (run 30419570545), the
Android SDK was 10.3 GiB for 44s while the other six were 13.7 GiB for ~11-16s combined.
Because the deletes run in parallel the step costs max(path), so dropping Android alone
took it from 51-71s to ~7-10s and still leaves ~9x the floor. **Same step, same safety,
~50s cheaper on both legs** — from measuring the parts rather than arguing about the whole.

**How we found out.** By doing it. The premise — "headroom past what is needed is waste" —
is the kind that reads as obviously true and is cheap to test, and the measurement was
unambiguous within one run. The failure mode it warns against is the opposite of the one
[the out-of-disk note](an-out-of-disk-runner-fails-as-the-test-it-was-running.md) covers:
there, the disk runs out and a test goes red for reasons nobody can attribute; here,
everything stays green and simply takes longer.
