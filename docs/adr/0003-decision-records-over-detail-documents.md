---
status: accepted
date: 2026-07-20
supersedes: ""
superseded-by: ""
tags: [docs, knowledge, agents]
---

# 0003. Decision records over detail documents; skills over bulk context

**Context.** The repo's knowledge lived in long documents: a 391-line
implemented "plan" still marked "no code written yet", a 148-line playbook
mostly describing already-enforced rules, a stale feature walkthrough, and an
always-loaded AGENTS.md that pushed whole-file reads. Detail documents rot
(the plan docs lied about their own status within weeks); agents bulk-loading
them wastes context on content irrelevant to the task at hand.

**Decision.** Knowledge is stored by kind, smallest-sufficient form, one home
per fact: decisions with alternatives + receipts → `docs/adr/` (immutable,
superseded not edited); cross-cutting one-line rules → AGENTS.md (the only
always-loaded file, kept a router); task-scoped rules and commands → on-demand
skills (`.claude/skills/`); anything mechanically enforceable → a CI gate or
DB guard, with the ADR recording why the gate exists. Long-form docs survive
only as distilled rationale (decisions + invariants), status-stamped, with
section numbers kept stable when code cites them. The `/compound` skill runs
this routing at session end.

**Alternatives rejected.**
- *Keep comprehensive design docs updated* — they demonstrably don't stay
  updated; two claimed "plan only" while running in production.
- *Put everything in AGENTS.md* — always-loaded context scales linearly with
  every lesson; most content is irrelevant to most sessions.
- *Delete history-heavy content outright* — git history preserves it, but only
  if the distillation says so; tombstones + stable section numbers keep ten
  code citations valid.

**Consequences.** New decisions cost a small ADR immediately (or they get
relitigated — the failure mode this buys out of). Humans browsing GitHub get
the card versions (playbook, ADR index); agents get task-scoped depth.
Superseding-not-editing means the index, not any single file, is the current
truth.

**Receipts.** Playbook 148→46 (`12fb3b2`); INGEST_FRESHNESS 391→142
(`07a9568`); walkthrough deleted (`6d982e6`); skills + router (`b0be31e`);
`/compound` + this directory (`46d4d8b`).
