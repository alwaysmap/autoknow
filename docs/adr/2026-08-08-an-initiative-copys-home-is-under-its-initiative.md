---
status: accepted
date: 2026-08-08
supersedes: ""
superseded-by: ""
extends: "an-initiative-is-a-template-snapshot-instantiated-as-excluded-project-copies"
extended-by: "an-initiative-template-edit-propagates-by-provenance"
tags: [initiatives, routing, urls]
---

# An initiative copy's home is under its initiative

**Context.** Copies are `Project` rows, so they were reachable at
`/programs/[id]` like any program. The owner's call (2026-08-08): a copy
presents UNDER its initiative — its page carries the initiative's framing, no
critical-chain section, and no phase-structure editing, because every member
shares the initiative's steps and only the initiative-level edit changes them.

**Decision.** The user-visible route is `/initiatives/[initiativeId]/[projectId]`
(`initiativeProjectHref`); the page 404s when the pair mismatches.
`/programs/[id]` REDIRECTS copies there, and the phase editor both redirects
and fails closed in `saveProgramPhases` (lesson 2). Surfaces that know the pair
link directly; generic `programHref` callers keep working via the redirect.

**Alternatives rejected.** Rendering copies at `/programs/[id]` with badges:
leaves the chain section and phase editing to suppress piecemeal, forever.
404ing the old shape: breaks every persisted citation — a URL here is DATA
(AGENTS lesson 15).

**Consequences.** Two program-detail assemblies exist (the program page and the
copy page) sharing the same components; they diverge deliberately in framing.
The copy page must be extended, not the program page filtered. Escalation and
activity paths on copies use `initiativeProjectHref` as their revalidate/anchor
path.

**Receipts.** gh-286 comments (2026-08-08); `tests/initiatives.spec.ts`
(redirect + chainless + locked assertions).
