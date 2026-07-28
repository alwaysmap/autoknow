---
status: accepted
date: 2026-07-22
supersedes: ""
superseded-by: ""
extends: "decision-records-over-detail-documents"
extended-by: "knowledge-is-reviewed-not-indexed"
tags: [docs, knowledge, agents, context]
---

# Findings get a third home, and the homes are priced by retrieval cost

**Context.** [Decision records over detail documents](2026-07-20-decision-records-over-detail-documents.md)
routed knowledge to three homes: decisions → `docs/adr/`, cross-cutting
one-liners → AGENTS.md, task-scoped rules → skills. A fourth kind kept arriving
with nowhere to go: a **finding** — how this system actually behaves, learned by
losing an hour to it. No choice was made, so it is not a decision; it is too
specific to earn an always-loaded line; it belongs to a symptom rather than to
one task. Those facts were being crammed into AGENTS.md one-liners, which is the
most expensive home in the repo, or lost.

**Decision.** Findings live in `docs/knowledge/<slug>.md` — undated (a note is
current understanding, not a historical act), edited in place, capped at 60
lines. And the four homes are chosen by **retrieval cost, not importance**:
AGENTS.md is loaded into every session, so a line there taxes every session
forever; a knowledge note costs nothing until a trigger matches. So the default
is a note, and an AGENTS.md line must earn itself — it does so only if an agent
who does not know the topic exists would still go wrong without it.

That only works if a reader can decide whether to open a note **without opening
it**, so front matter is the interface and carries two *triggers*, never topics:
`applies_to` (what you are about to touch — matched while planning) and
`symptoms` (what you are seeing — matched while stuck). A tag like `css` is
useless, because nobody goes looking for "a note about CSS".

**Alternatives rejected.**
- *Keep putting findings in AGENTS.md* — the thing being fixed; always-loaded
  context scales linearly with every fact, and most facts are irrelevant to most
  sessions.
- *Put them in the task skills* — a skill is loaded by task, but findings are
  triggered by a file or a symptom that crosses tasks, and a skill has no place
  to state that trigger.
- *Make them ADRs* — an ADR is immutable because a decision is a historical act;
  a finding improves as understanding does, and freezing it forces a supersession
  chain for what should be an edit.
- *Tag-based retrieval* — tags describe the note's topic, and retrieval fails on
  exactly the case that matters: the reader does not yet know the topic is
  relevant.

**Consequences.** A fourth directory to keep honest, and one more routing
judgement per `/compound` run. `tests/knowledgeNotes.test.ts` carries the cost:
it enforces the undated filename, the six required front-matter keys, the status
enum, the length cap, index completeness, and that every `docs/knowledge/` path
cited anywhere in the repo resolves — the same guarantees `adrNaming.test.ts`
gives ADRs, because neither is self-enforcing. Existing AGENTS.md lessons were
NOT migrated; they shrink to pointers as each earns a note.

**Receipts.** `docs/knowledge/` + index + guard, and the first note
([A CSS-module class cannot win a `display` fight with a global `[data-*]` rule](../knowledge/css-module-loses-display-to-global-attribute-rule.md)),
this session. That note is the worked example: it cost an hour during the
search-dial move, and nothing in the repo would have warned about it.
