---
name: compound
description: Capture what a session learned or decided as compounding knowledge — ADRs in docs/adr/, one-liner lessons in AGENTS.md, receipts on existing records. Invoke at the end of a working session, after an incident, or whenever a real decision was made ("/compound", "capture what we learned").
---

# Compound the session's knowledge

Preserve **decision records agents and humans can reason about**, never long
narrative documents. A decision that isn't recorded gets relitigated; a
narrative that is recorded rots. Everything below serves that line.

## 1. Mine three sources

- **This session's conversation**: decisions made, alternatives rejected,
  incidents diagnosed, rules the user stated.
- **Git log since the newest ADR/lesson**: `git log --oneline <last>..HEAD` —
  commit messages here carry diagnosis + evidence by convention (AGENTS
  lesson 11); an incident-shaped commit is ADR raw material.
- **Agent memory**, if present (`~/.claude/projects/*/memory/`): facts worth
  promoting from private memory into the repo where every agent and human
  sees them.

## 2. Apply the bar — actionable or left out

Record only what is (a) **not derivable from the code**, (b) **likely to
recur**, and (c) **actionable** — it changes what the next agent/human does.
Drop: narratives, progress reports, anything a test or type already enforces,
one-off trivia. If a rule can be *mechanically enforced* instead (CI gate, DB
role, lint), propose the enforcement — an enforced rule needs no memory
(AGENTS lesson 2); the ADR then records *why the gate exists*.

## 3. Route each item to the right home (augment before creating)

| Kind | Home |
|---|---|
| A decision with alternatives + consequences | `docs/adr/YYYY-MM-DD-slug.md` (format below) |
| A cross-cutting one-line rule | AGENTS.md "Compounding lessons" (append; keep it one line, point at the ADR/skill for receipts) |
| A task-scoped rule or command | the matching skill (`ui-design`, `db-change`, `qa`, …) |
| New evidence for an EXISTING record | add a receipt line to that ADR — do not write a duplicate |
| A reversal of an existing ADR | new ADR; mark the old one `superseded-by: <slug>` (never edit history) |

Check `docs/adr/`, AGENTS.md lessons, and the skills for overlap BEFORE
writing. One fact, one home, cross-linked.

## 4. ADR format (short — a screen, not a chapter)

`docs/adr/YYYY-MM-DD-kebab-slug.md` — **dated, never numbered**. A sequence
number needs a central allocator; two branches writing a record on the same day
both take the next free one, and because the slugs differ git merges them with no
conflict at all — two records sharing an id. The date needs no coordination, and
same-day records still differ by slug. Use the date you write it. The SLUG is the
identity that prose cites; the date only sorts the directory.

```markdown
---
status: accepted            # accepted | superseded
date: YYYY-MM-DD
supersedes: ""              # optional slug of the record this replaces
superseded-by: ""           # filled in later, by the reversing ADR
tags: [deploy, ci]
---

# Imperative title of the decision

**Context.** 2–4 sentences: the forcing situation, with the incident/receipt.

**Decision.** What we do now, stated as a rule.

**Alternatives rejected.** Each with the one reason that killed it.

**Consequences.** What this commits us to; what it deliberately gives up.

**Receipts.** Commits/PRs/incidents, e.g. `1810c5d`, PR #16, 2026-07-20 outage.
(Rebase rewrites SHAs — if you rebase after writing these, fix them; a receipt
pointing at a commit that no longer exists is worse than none.)
```

## 5. Finish the loop

- Update `docs/adr/README.md`'s index table (date · title · status · tags), in
  date order. `npm run test -- tests/adrNaming.test.ts` checks the filename shape
  and that the index lists every record exactly once.
- Validate every relative link you wrote resolves.
- Commit with a message that itself meets the bar (diagnosis + evidence).
- Tell the user what was recorded, what was augmented, and — explicitly —
  what you judged NOT worth recording and why.
