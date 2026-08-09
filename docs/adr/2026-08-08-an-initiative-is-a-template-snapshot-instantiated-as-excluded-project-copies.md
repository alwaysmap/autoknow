---
status: accepted
date: 2026-08-08
supersedes: ""
superseded-by: ""
extends: ""
extended-by: ""
tags: [schema, initiatives, programs]
---

# An initiative is a template snapshot instantiated as excluded Project copies

**Context.** An Initiative applies one workflow to 1+ partners, where a Program
(`Project`) is exactly one partner by construction. The per-partner work needs
phases, state history, lifecycle, and at-risk math — everything a Program
already has (gh-286, planned 2026-08-08).

**Decision.** Three coupled rules:
1. A per-partner copy **is a `Project`** (`initiativeId Int?` FK). Copies are
   **excluded from every program surface** — `/programs`, ecosystem counts,
   SOP-risk tallies, capacity, the timeline — and surface on initiative and
   partner pages instead. Every program-enumerating query states its stance on
   `initiativeId` explicitly.
2. The initiative's workflow definition is a **private snapshot clone** of a
   `ProgramTemplate` (unique 1:1 `templateId`); template lists hide snapshots by
   the back-relation, not a flag.
3. Membership is an **explicit fact** (`InitiativePartner`, active|removed, one
   row per pair) — never inferred from copies. Remove cancels the copy and keeps
   it; re-add starts a fresh copy on the same join row.

**Alternatives rejected.** A parallel initiative-work entity: re-implements the
entire progress/history machinery. Including copies in program surfaces with a
badge: every count/detail pair must then handle date-less copies to keep the
summary-count ADR honest. A live template reference: later joiners silently
instantiate an edited workflow. Inferred membership: cannot distinguish
"removed from initiative" from "cancelled for another reason".

**Consequences.** `Project.initiativeId` is `onDelete: Restrict` — not the
nullable-FK house default of SET NULL — because detaching would silently promote
copies into regular programs; deleting an initiative must first decide what its
copies become. The wipe paths delete each initiative's snapshot template with it,
or the snapshot outlives the FK that hides it from template lists. Exclusion is
a per-query obligation, not a global filter — the sweep list lives in gh-286.

**Receipts.** gh-286 (the decision record with full rationale); migration
`20260808205337_initiatives_schema`; `tests/wipeAllCoverage.test.ts` exercises
the RESTRICT ordering.
