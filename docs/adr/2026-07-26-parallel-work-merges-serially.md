---
status: accepted
date: 2026-07-26
supersedes: ""
superseded-by: ""
extends: serialize-deploys-newest-wins
extended-by: ""
tags: [deploy, ci, process, agents]
---

# Parallel work builds in parallel and merges one at a time

**Context.** Running the delivery queue with several agents at once (2026-07-25,
issue #134) raised a question the deploy ADR had answered for machines but not for
process. `deploy.yml`'s concurrency group keeps only the *newest* queued run, and
that ADR already accepts the consequence: *"Burst merges deploy only the final
state (intermediate commits never get their own revision — acceptable: each deploy
is cumulative)."*

That is true and fine for the deploy. It is **fatal to per-merge verification.**
The queue's working agreement is merge → watch the deploy → `curl /api/health` and
compare `.sha` → self-assess → tick. If three PRs are merged in a burst, two of
those SHAs never get a revision at all, so the health check waits for a SHA that
will never appear — and the natural reaction is to conclude the deploy is stuck
and re-dispatch it, which is the exact non-problem AGENTS lesson 1 warns about.

**Decision.** Work may be **built** in parallel — one git worktree per stream,
which is separately required because a worktree owns exactly one `*_test` database
and one e2e port (AGENTS lesson 9). Work is **merged serially**: one PR at a time,
each merge watched through its deploy and health-checked against its own SHA before
the next merge starts.

If a burst merge ever is deliberate, the verification must change with it —
health-check the final SHA once and say explicitly which intermediate commits were
never deployed. Silently keeping the per-merge ritual over a burst is the failure
this record exists to prevent.

**Alternatives rejected.**
- *Merge in a burst, health-check only the final SHA.* Cheaper, and it forfeits the
  thing the ritual buys: which change broke prod. A single green check over three
  merges cannot attribute a regression.
- *Remove the concurrency group so every commit deploys.* Reverses the
  2026-07-20 incident that created it — parallel deploys finished out of order and
  prod served the oldest commit while every run showed green.
- *Serialize the building too.* Wastes the parallelism entirely; building is where
  the wall-clock is, and builds in separate worktrees genuinely do not interact.

**Consequences.** Throughput is bounded by the merge/deploy/verify cycle (~5–8
minutes each), not by build time — so parallel building pays only while the number
of concurrent streams is small. Agents running a queue must treat "merge" as a
critical section, and a stream that finishes early waits.

**Receipts.** Extends
[Serialize deploys; newest queued merge wins](2026-07-20-serialize-deploys-newest-wins.md).
Applied across seven merges on 2026-07-25/26 (PRs #152, #155, #160, #162, #163,
#169, #170), each health-checked against its own SHA: `9e3fe7e`, `dadb0f7`,
`046ab5f`, `b517c2f`, `948b89d`, `ae8c4de`, `b4c65de`.
