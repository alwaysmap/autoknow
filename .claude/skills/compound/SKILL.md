---
name: compound
description: Capture what a change learned or decided as compounding knowledge — decisions as ADRs in docs/adr/, findings as notes in docs/knowledge/, always-on rules as AGENTS.md one-liners. Invoke BEFORE MERGING any PR that touches src/** or prisma/** — CI (ci:lint-compound) blocks the merge until a commit message declares `compound: <path>` or `compound: none — <reason>`. Also invoke after an incident or whenever a real decision was made ("/compound", "capture what we learned").
---

# Compound the session's knowledge

The goal is that the next person — agent or human — moves **faster, with more
confidence, and reworks less**. That only happens if what you record is
retrievable at the moment it would help and invisible the rest of the time.
Preserve records that can be reasoned about, never narrative documents: a
decision that isn't recorded gets relitigated; a narrative that is recorded rots.

## 1. Mine three sources

- **This session's conversation**: decisions made, alternatives rejected,
  incidents diagnosed, rules the user stated, and — easy to miss — the hours you
  lost to something that turned out to be knowable.
- **Git log since the newest record**: `git log --oneline <last>..HEAD` — commit
  messages here carry diagnosis + evidence by convention (AGENTS lesson 11); an
  incident-shaped commit is raw material.
- **Agent memory**, if present (`~/.claude/projects/*/memory/`): facts worth
  promoting from private memory into the repo where everyone sees them.

## 2. Apply the bar — actionable or left out

Record only what is (a) **not derivable from the code**, (b) **likely to
recur**, and (c) **actionable** — it changes what the next agent/human does.
Drop narratives, progress reports, anything a test or type already enforces, and
one-off trivia.

**Prefer enforcement to prose.** If a rule can be mechanically checked (CI gate,
lint rule, DB role, a test), write the check — an enforced rule needs no memory
(AGENTS lesson 2), and the record then explains *why the gate exists* rather
than asking anyone to remember the rule.

## 3. Route it — the homes differ by RETRIEVAL COST, not by importance

This is the judgement the skill exists to make. Ask what kind of thing you have:

| You have… | Home | Cost |
|---|---|---|
| a **choice** between viable options, now binding | `docs/adr/YYYY-MM-DD-slug.md` | read when the question resurfaces |
| a **finding** — how this system actually behaves, learned the hard way | `docs/knowledge/<slug>.md` | free until a trigger matches |
| a rule so cross-cutting that **every session** needs it in mind | AGENTS.md "Compounding lessons" (one line) | **paid by every session, forever** |
| a rule only **one kind of task** needs | the matching skill (`ui-design`, `db-change`, `qa`, …) | paid by that task |
| new evidence for an **existing** record | a receipt line on that record — never a duplicate | — |
| an **extension** — the old record still holds, but no longer describes the whole system | new ADR; mark the old `extended-by: <slug>` | — |
| a **reversal** of an existing ADR | new ADR; mark the old `superseded-by: <slug>` (never edit history) | — |

**AGENTS.md is the expensive home.** It is loaded into every session, so each
line there taxes every future session whether or not it is relevant. A knowledge
note costs nothing until someone matches its trigger. So: **default to a
knowledge note, and make the AGENTS.md line earn itself.** It earns itself only
if an agent who does *not* know the topic exists would still go wrong without it.
If the trigger is a file, a command, or a symptom, that is a note, not a lesson.

When a lesson does get its own note, ADR, or skill section, **shrink the
AGENTS.md line to a pointer** — one clause of danger plus where the detail lives.
The lesson list is an index of dangers, not a store of detail. Before writing a
new lesson, check whether a skill already carries it: the first sweep of that
list (2026-07-22) found six of eighteen were duplicating skill content verbatim,
which is context paid for twice and two copies free to drift apart.

**Never renumber the lessons list.** The lessons are cited by number from code,
tests and records, so a deletion or reorder silently re-points every citation.
Rewrite text freely; keep numbers fixed; retire in place.
`tests/agentsLessons.test.ts` enforces it.

Check `docs/adr/`, `docs/knowledge/`, AGENTS.md, and the skills for overlap
BEFORE writing. One fact, one home, cross-linked.

## 4. Formats

### ADR — `docs/adr/YYYY-MM-DD-kebab-slug.md`, dated, immutable

**Dated, never numbered.** A sequence number needs a central allocator; two
branches writing on the same day both take the next free one, and because the
slugs differ git merges them with no conflict — two records sharing an id. The
SLUG is the identity that prose cites; the date only sorts the directory.

```markdown
---
status: accepted            # accepted | superseded
date: YYYY-MM-DD
supersedes: ""              # optional slug of the record this replaces
superseded-by: ""           # filled in later, by the reversing ADR
extends: ""                 # optional slug this record adds to, without reversing
extended-by: ""             # filled in later, by the extending ADR
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

### Knowledge note — `docs/knowledge/<kebab-slug>.md`, undated, living

Read [docs/knowledge/README.md](../../../docs/knowledge/README.md) for the full
contract. The essentials:

**Front matter is the interface; the body is the payload.** A reader must be able
to decide whether to open the note *without opening it*, so the two retrieval
keys carry conditions, not topics — `applies_to` is what you are about to touch
(matched while planning), `symptoms` is what you are seeing (matched while
stuck). A tag like `css` is useless: nobody goes looking for "a note about CSS".

```markdown
---
title: The lesson itself, stated as a claim you could act on
status: current                  # current | superseded | retired
updated: YYYY-MM-DD              # living document; this is the staleness signal
applies_to:
  - src/**/*.module.css          # paths, commands, surfaces
symptoms:
  - element has the right classes but renders in the wrong place
verified_by: 'tests/foo.spec.ts "the case"; PR #20'   # mandatory — no receipt, no note
---

# Same claim as the title

**The lesson.** The rule, in one paragraph.

**Why it bites.** The mechanism. This is what makes it transferable instead of a
spell — a reader who understands the mechanism recognises the next instance.

**What to do.** The concrete move, specific enough to act on.

**How we found out.** Optional, one paragraph: the incident, and what failed to
catch it.
```

Undated filename, deliberately: the date prefix is how a reader tells an
immutable decision from current understanding at a glance. Notes are edited in
place — bump `updated:`. A note whose subject was fixed upstream becomes
`retired`, not deleted: "we used to have to do X, and no longer do" is itself
worth knowing.

Keep it under 60 lines. Past a screen it is a document, and documents rot.

## 5. Finish the loop

- **ADR**: update `docs/adr/README.md`'s index table (date · title · status ·
  tags), in date order.
- **Knowledge note**: add its row to `docs/knowledge/README.md`'s index —
  `| [title](<slug>.md) | load it when… |`. The trigger column is what agents scan
  instead of the directory; a note missing from the index is a note nobody finds.
- **First note for a task surface**: add a one-line pointer to that surface's
  skill (`ui-design`, `db-change`, …) naming the `applies_to` values that select
  its notes. Add it only when notes exist — a pointer to nothing is noise.
- Run `npm run test -- tests/adrNaming.test.ts tests/knowledgeNotes.test.ts tests/agentsLessons.test.ts`
  — they check filename shape, required front matter, the length cap, index
  honesty, contiguous lesson numbering, and that every ADR path, knowledge path,
  and `AGENTS lesson N` cited anywhere in the repo resolves.
- Validate every other relative link you wrote resolves.
- **Commit onto the PR branch, before the merge — never onto `main` afterwards.**
  A record that lands later is an orphan docs-only commit divorced from the change
  that motivated it, which is the whole reason this trigger moved (ADR
  `compound-records-ride-the-pr-that-motivated-them`). Message meets the bar
  itself (diagnosis + evidence), and carries the declaration line
  `scripts/ci/lint-compound.sh` requires:

  ```
  compound: docs/adr/YYYY-MM-DD-slug.md
  compound: none — pure refactor, no new knowledge
  ```

  A named path must be in the PR's own diff. `none` must carry a reason.
- **Expect CI to go green twice.** The records you just pushed re-trigger it, and
  `adrNaming` / `knowledgeNotes` / `agentsLessons` then run against the new files —
  records are gated like code. Merge on the *second* green, not the first.
- Tell the user what was recorded **and where**, what was augmented, and —
  explicitly — what you judged NOT worth recording and why.
