---
status: accepted
date: 2026-07-24
supersedes: ""
superseded-by: ""
extends: ""
extended-by: ""
tags: [docs, knowledge, ci, agents, process]
---

# Compound records ride the PR that motivated them, and CI blocks the merge until the judgement is declared

**Context.** `compound` fired at **end of session**, which is the wrong boundary.
A session can end after its PR merged, or produce no PR at all, so the records it
writes either land later as an orphan docs-only commit or never get written —
the knowledge is furthest from the change that motivated it exactly when it is
cheapest to attach. The repo already held the opposite rule for the neighbouring
case: AGENTS lesson 10, *"the PR that implements or retires what a doc describes
updates that doc's STATUS line."* Compound records are the same shape and got a
different lifecycle by accident. The trigger was also stated in prose in three
places with nothing keeping the copies in agreement, and no mechanical check
behind any of them — including the skill's own front-matter `description`, which
is the retrieval key, so a correct body under a stale description would have
changed nothing.

**Decision.** The trigger is **CI green → compound → push → CI green again →
merge**. Every PR touching `src/**` or `prisma/**` must carry, in some commit
message in the range, either `compound: <path to a record in this diff>` or
`compound: none — <reason>`. `scripts/ci/lint-compound.sh` (`ci:lint-compound`,
in the existing `migrations-lint` job) enforces it, and asserts that a named path
is actually in the diff — otherwise the line is a rubber stamp.

**Alternatives rejected.**

- **Leave it as prose in the skill.** AGENTS lesson 2: a rule that ships without
  its guard is a rule people remember for a fortnight. This one had already
  drifted across three copies.
- **Fire only when the diff smells like a decision** (touches `AGENTS.md`,
  `docs/design.md`, adds a `scripts/ci/*` guard). Cheaper, but a heuristic that
  lets most PRs through reintroduces precisely the skipping this exists to fix.
  Dropping to it later is a one-line change to the script's file filter, so the
  cost of trying the strict version first is a week.
- **A PR-body field instead of a commit-message line.** Would need a `gh` API
  call from CI, would not survive squash-merge into history, and would not match
  the `allow-mixed-infra:` precedent the script is modelled on.
- **A user-level `PreToolUse` hook alone**, like the readability-review gate.
  That protects one machine and one person; it binds neither humans, nor the
  GitHub web UI, nor any agent that never loads a hook. The hook ships too, but
  from the repo's own `.claude/settings.json`, and it is fail-open convenience —
  CI is the gate.

**Consequences.** Records are now gated like code: pushing them re-triggers CI,
so `adrNaming` / `knowledgeNotes` / `agentsLessons` run against the new files and
"compound after CI is green" is a **loop, not a step** — merge on the second
green. Every substantive PR pays one line, and `none — <reason>` is a few seconds
when there is nothing; that friction is the point, because the judgement is what
was being skipped. The filter is `src/**` and `prisma/**` only, so docs-, CI-,
test-, script- and skill-only PRs are deliberately exempt — including the PR that
introduced this gate. `docs/adr/` and `docs/knowledge/` should now grow in step
with `src/` rather than in retrospective bursts.

**Receipts.** Issue #131 (which states the three-place sweep and the acceptance
bar). Guard: `scripts/ci/lint-compound.sh`; hook:
`scripts/hooks/compound-merge-gate.sh`; proof it fails and passes:
`tests/lintCompound.test.ts`, 23 cases over real disposable git repos — written
instead of the issue's "throwaway PR both ways", which proves the gate once
rather than on every run. Review of that first draft found the gate reading
`git log <base>...HEAD`, whose symmetric difference scans the base side too, so
one merged PR's declaration would have failed the next PR — a bug this gate would
have made near-universal within days, and the reason `require_base_ref` and the
two-dot range now live in `scripts/ci/lib.sh` and were swept across all three
`lint-*.sh` gates (AGENTS lesson 7).
