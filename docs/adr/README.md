# Architecture Decision Records

Short, immutable decision records — the compounding memory of this project.
Created and maintained by the `compound` skill (see `.claude/skills/compound/`):
each captures one decision with its context, rejected alternatives,
consequences, and receipts. Reversals get a NEW record that supersedes the old
one; history is never edited.

Related knowledge with other homes: cross-cutting one-liners live in
[AGENTS.md](../../AGENTS.md) "Compounding lessons"; task-scoped rules live in
the agent skills; subsystem design rationale lives in the distilled plan docs
([INGEST_FRESHNESS_PLAN](../INGEST_FRESHNESS_PLAN.md) is the model: decisions
and invariants kept, narrative deleted).

## Index

| ADR | Title | Status | Tags |
|---|---|---|---|
| [0001](0001-serialize-deploys-newest-wins.md) | Serialize deploys; newest queued merge wins | accepted | deploy, ci |
| [0002](0002-e2e-flows-only-deliberate-matrix.md) | E2E tests user/system flows only, on a deliberate browser matrix | accepted | testing, e2e |
| [0003](0003-decision-records-over-detail-documents.md) | Decision records over detail documents; skills over bulk context | accepted | docs, knowledge, agents |
| [0004](0004-premerge-quality-gate.md) | Every PR runs the full quality gate, because merges auto-deploy | accepted | ci, testing, deploy |
| [0005](0005-session-is-the-only-source-of-who-i-am.md) | The signed-in session is the only source of "who I am" | accepted | auth, identity, seed, demo |
