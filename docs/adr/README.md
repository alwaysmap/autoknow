# Architecture Decision Records

Short, immutable decision records — the compounding memory of this project.
Created and maintained by the `compound` skill (see `.claude/skills/compound/`):
each captures one decision with its context, rejected alternatives,
consequences, and receipts. Reversals get a NEW record that supersedes the old
one; history is never edited.

## Naming: `YYYY-MM-DD-kebab-slug.md`, never a sequence number

Records were numbered `0001…` until 2026-07-21, and the scheme broke the first
time two branches wrote one at once: both picked the next free number, and
because the filenames differed (`0005-session-…` vs `0005-retiring-…`) git
merged them without a conflict — two records sharing a number, two index rows
claiming it, and nothing to notice. A sequential id needs a central allocator,
which a repo with concurrent branches does not have.

The date has no such problem: it comes from the day you write the record, needs
no coordination, and two records written the same day still differ by slug. It
also sorts chronologically in `ls`, which is the order these are read in.

* **The SLUG is the identity** — stable, greppable, and what prose cites: "ADR
  `premerge-quality-gate`". The date prefix only orders the directory.
* **Reference it as a link where the medium allows** (`[ADR: <title>](<path>)`),
  and as `ADR <slug>` in code comments, where a link is not clickable.
  Placeholders in docs are spelled with angle brackets so a link checker can tell
  them from a real path that has rotted.
* **`supersedes:` / `superseded-by:` carry the other record's slug**, not a
  number. A reversal is a NEW record; history is never edited.
* **`extends:` / `extended-by:` are the same machinery for the non-reversal
  case**: the old record still holds but no longer describes the whole system.
  Without the forward pointer it quietly starts lying. Filling in a forward field
  is additive, not a history edit.
* `tests/adrNaming.test.ts` enforces the shape, and that every ADR path cited
  anywhere in the repo resolves.

Related knowledge with other homes: **findings** — how the system actually
behaves, learned the hard way, as opposed to anything we chose — live in
[docs/knowledge/](../knowledge/README.md), undated and edited in place;
cross-cutting one-liners live in [AGENTS.md](../../AGENTS.md) "Compounding
lessons"; task-scoped rules live in the agent skills; subsystem design rationale
lives in the distilled plan docs ([INGEST_FRESHNESS_PLAN](../INGEST_FRESHNESS_PLAN.md)
is the model: decisions and invariants kept, narrative deleted). The `compound`
skill routes between them.

