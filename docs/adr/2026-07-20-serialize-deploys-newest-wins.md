---
status: accepted
date: 2026-07-20
supersedes: ""
superseded-by: ""
extended-by: parallel-work-merges-serially
tags: [deploy, ci]
---

# Serialize deploys; newest queued merge wins

**Context.** Five PRs merged within two minutes on 2026-07-20. Their deploy
runs executed in parallel and finished out of order: one failed with
`ABORTED: Conflict for resource 'autoknow': version ...`, and production ended
up serving the *oldest* of the five commits while every newer run reported
green. Nothing detected it — the Actions UI showed success.

**Decision.** `deploy.yml` declares a workflow-level concurrency group
(`group: deploy`, `cancel-in-progress: false`): exactly one deploy runs at a
time; GitHub keeps only the newest queued run, so the latest commit always
deploys last; in-flight runs (mid-migration) are never cancelled. Deploy
verification is `curl /api/health` → compare `.sha` to `origin/main`, never
the Actions UI.

**Alternatives rejected.**
- *`cancel-in-progress: true`* — could kill a run mid-`prisma migrate deploy`.
- *Do nothing, redeploy manually when it happens* — the failure is silent; the
  2026-07-20 incident was only noticed by manually querying what Cloud Run was
  serving.
- *Serialize inside `build-and-deploy.sh` with retries on ABORTED* — retries
  make the losing (older) run win MORE often, inverting the desired order.

**Consequences.** Burst merges deploy only the final state (intermediate
commits never get their own revision — acceptable: each deploy is cumulative).
The queue adds latency only when merges overlap. `/api/health` exposing the
build `sha` becomes load-bearing for verification.

**Receipts.** Incident 2026-07-20 (prod served `a935b4d` while `e9024c6`
showed green); fix `0de3667`; health probe `f15fd4b`; PR #16; runbook
OPERATIONS §9; one-liner: AGENTS.md lesson 1.
