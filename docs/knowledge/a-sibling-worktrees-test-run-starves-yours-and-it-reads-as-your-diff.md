---
title: A sibling worktree's test run starves yours — every DB suite times out at once, and it reads as your diff
status: current
updated: 2026-08-15
applies_to:
  - npm run test / npm run evidence on a machine running several agent worktrees
  - diagnosing a jest failure that does not reproduce when the suite is re-run alone
symptoms:
  - a dozen or more DB-backed suites fail in one run and every one passes in isolation
  - "Exceeded timeout of 20000 ms" and "Connection terminated due to connection timeout"
  - suite wall-clock is 20-190s where the same suites normally finish in seconds
  - a DIFFERENT set of suites fails on each run, with no assertion failures among them
verified_by: 'autoknow-dn8, 2026-08-15: 21 suites failed while pg_stat_activity showed worktree 43ff3462 running its own suite throughout; the identical tree had passed 1335/1335 twice minutes earlier'
---

# A sibling worktree's test run starves yours

**The lesson.** The per-worktree, per-worker test databases (AGENTS lesson 9) isolate
DATA, and nothing else. CPU, disk and the one local Postgres are shared by every worktree
on the machine. When a sibling agent is running its own suite, yours competes for all
three — and jest's per-test timeout is WALL CLOCK, so the loser reports timeouts rather
than slowness. Nothing is wrong with your diff.

**Why it bites.** The failure wears exactly the costume of a real regression: many suites
red at once, right after you touched shared code. But three tells separate it, and all
three are visible in the output you already have:

* **Not one assertion failure.** Every message is `Exceeded timeout of 20000 ms` or
  `Connection terminated due to connection timeout`. A logic regression produces an
  expected-vs-received.
* **The wall-clock is absurd.** Suites that normally finish in single-digit seconds report
  30–190s. That is the actual signal; the timeout is a consequence.
* **The failing SET moves between runs.** A regression fails the same suites every time.

**What to do.** Before suspecting the diff, ask the database who else is working:

```sql
SELECT datname, count(*) FROM pg_stat_activity
WHERE datname LIKE 'autoknow%' GROUP BY 1 ORDER BY 2 DESC;
```

Any `autoknow_<token>_{j,w}<n>_test` whose token is not YOUR worktree's is a sibling suite
in flight (`worktreeToken()` in `tests/helpers/worktree.ts` prints yours). If one is there,
wait for it and re-run — do NOT start editing. Re-running a genuine flake is what AGENTS
warns against; this is not a flake in the code, it is a second job on the same machine, and
the equivalent move to the fresh-worktree diagnosis is to confirm the failure is unrelated
to the diff rather than to work around it. If you cannot wait, run the suites you actually
touched by path: they pass, and that is a real signal rather than a re-roll.

**How we found out.** 21 suites failed on a tree that had passed 1335/1335 twice within the
hour, with only markdown changed in between. Polling `pg_stat_activity` during the run
showed worktree `43ff3462` active in every sample.
