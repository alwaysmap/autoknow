---
status: accepted
date: 2026-07-20
supersedes: ""
superseded-by: ""
tags: [ci, testing, deploy]
---

# Every PR runs the full quality gate, because merges auto-deploy

**Context.** Merging to `main` deploys to production automatically
(deploy.yml), but PRs only ran `migrations-lint`. PR #15 merged green while
breaking an e2e assertion — nothing behavioral ran pre-merge, so drift shipped
silently and was only caught days later by a local run.

**Decision.** `ci.yml`'s `quality` job runs typecheck → lint → jest → the
trimmed Playwright suite → a prod build on every PR, against a pgvector
service container (tests self-provision the disposable `*_test` DB). CI is the
backstop; `npm run evidence` locally remains the feedback loop. Mechanical
ordering rules are CI gates too: destructive-migration lint and the
mixed-infra/app PR gate, each with a reviewed in-diff opt-in
(`-- allow-destructive:` / `allow-mixed-infra:`).

**Alternatives rejected.**
- *Keep the gate local-only (`npm run evidence`)* — honor-system; PR #15 is
  the counterexample.
- *Run a subset (lint+jest) for speed* — the incident WAS an e2e-only miss;
  the flows-only suite (ADR e2e-flows-only-deliberate-matrix) made the full gate affordable (~10 min).
- *Gate on merge to main instead of PRs* — too late: the same push triggers
  the deploy.

**Consequences.** PR feedback includes a ~10-minute check; browser binaries
are cached to keep it there. The rule generalizes: in an auto-deploy repo,
any "never do X" worth writing down is worth a CI gate with a visible opt-in.

**Receipts.** PR #15 (the miss); `1810c5d` (quality job); `12fb3b2`
(ordering gate); ADR e2e-flows-only-deliberate-matrix (what made it affordable).
