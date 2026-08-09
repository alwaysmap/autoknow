---
status: accepted
date: 2026-08-09
supersedes: ""
superseded-by: ""
extends: "an-initiative-copys-home-is-under-its-initiative"
extended-by: "an-initiative-links-devices-from-the-membership-to-real-programs"
tags: [initiatives, templates, schema]
---

# An initiative template edit propagates by provenance

**Context.** Copies cannot deviate from their initiative's steps, and only the
initiative-level edit changes them (owner call 2026-08-08). Shipping the edit
surface without propagation would let later joiners get new steps while
in-flight copies kept old ones — deviation by another door.

**Decision.** `Phase.sourcePhaseTemplateId` records which template step each
copy phase was instantiated from. Saving an initiative's snapshot template
(`saveTemplatePhases`) re-syncs every ACTIVE member copy in the same
transaction (`lib/initiativeSync`): a kept step overwrites name/duration/
content and keeps the copy phase's progress and history — a RENAME is matched
by provenance id, never by the name it just changed; a removed step deletes the
copy phase with the same record recipe the program editor uses (context
detached, not deleted); an added step arrives at zero progress. Complete and
cancelled copies are history and are never rewritten. The migration bootstraps
provenance for pre-existing copies by name, once.

**Alternatives rejected.** Name matching forever: a rename becomes
remove-plus-add and silently destroys progress. Prompting per-copy: re-opens
per-copy deviation. Async propagation: a half-propagated initiative violates
the same-steps rule the feature exists for.

**Consequences.** The template editor is the one write surface for steps
(`/templates/[id]/edit`, reached from the initiative kebab; a banner states the
blast radius). Deleting a template step SET NULLs stray provenance rather than
blocking, because the sync deletes matching copy phases in the same
transaction. A future non-initiative use of provenance (e.g. program-vs-
template drift reporting) inherits the column for free.

**Receipts.** gh-286 comments; migration `phase_source_template_provenance`;
`tests/initiativeSync.test.ts` (rename-keeps-progress, history-untouched,
later-join-gets-edited-steps).
