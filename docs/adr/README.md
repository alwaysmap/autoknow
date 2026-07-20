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
