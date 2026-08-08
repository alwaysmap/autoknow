---
status: accepted
date: 2026-08-08
supersedes: ""
superseded-by: ""
extends: "an-initiative-is-a-template-snapshot-instantiated-as-excluded-project-copies"
extended-by: ""
tags: [initiatives, ownership]
---

# An initiative copy starts unowned

**Context.** Adding a partner to an initiative instantiates a Project copy
(gh-286 part c). Every other program-creation path requires an owner because a
human picks one on the form; a bulk membership add has no such picker, and the
person clicking "Add partners" is often not the Googler who will run the work.

**Decision.** Copies are created with `NO_OWNER` (both halves of the pair null).
Ownership is assigned later, per copy, through the program page's existing owner
picker — the same "unowned program asks for a TEL" state the app already treats
as honest.

**Alternatives rejected.** Auto-assigning the adder: fabricates an ownership
fact nobody stated (the session says who ADDED, not who OWNS — cf. the
session-is-the-only-source-of-who-i-am ADR's spirit). Requiring an owner input
on the add flow: forces one owner across a batch of partners whose work will be
owned by different people.

**Consequences.** `createProgramFromTemplate` accepts `OwnerFieldsOrNone`
(loosened in gh-286 part c); its seed ActionItem is created unassigned when
there is no owner — both assignee columns null, the pair discipline intact.
`/programs/new` keeps requiring a real owner as its own form policy.

**Receipts.** gh-286 decisions; `src/app/actions/initiatives.ts` `addPartners`;
`tests/initiativeActions.test.ts`.
