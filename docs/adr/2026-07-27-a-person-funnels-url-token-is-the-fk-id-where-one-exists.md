---
status: accepted
date: 2026-07-27
supersedes: ""
superseded-by: ""
extends: ""
extended-by: ""
tags: [ui, tables, urls, people]
---

# A person column's shareable URL token is the FK id wherever a relation exists

**Context.** design.md §6 said a person funnel "keeps the STORED string as its
value (a locale-stable shareable token)". For the program-owner column that
stored string was `Project.ownerName` — an **email address**. An address is a
property of a job, not of a human (#124 §2), so one person who had changed
company produced **two options in the same funnel**, neither of which selected
all their programs. That is #124 Class 4 wearing the table grammar's clothes.
#127 E6 added `Project.ownerPersonId` + FK; E7 moved the readers onto it, at
which point the funnel was the last surface still keyed on the address.

**Decision.** A person column backed by a foreign key uses the **person id** as
its filter value and URL token (`?owner=16`), and reads the name only in
`filterLabel`. `personRefFunnel` in `src/components/PersonCell.tsx` returns the
three header props together — `filterValue`, `filterLabel` and `sortValue` — so a
call site cannot spell one without the others; the third is needed because sorting
otherwise reads the `PersonRef` under the column key and stringifies it. A person
column with **no** relation keeps the stored string via `personFilterLabel`:
`Template.createdBy` and `ContextUrl.addedBy` funnel that way today, and
`ActionItem.assignedTo` joins them when its readers move onto
`assignedToPersonId`.

**Alternatives rejected.**
- *Keep the stored string, to preserve `?ownerName=` deep links.* The links it
  preserves are the broken ones — a shared URL naming an address its owner has
  left selects nothing. Nothing persists these tokens either: they appear only in
  e2e specs and one comment, so lesson 15's "migrate the data that cites it" has
  no rows to migrate.
- *Use the person's NAME as the token.* Reads better in the address bar and is
  strictly worse as a key: names are mutable (#124 §2 makes `name` latest-wins)
  and two people may share one.
- *Leave the funnel alone and call E7 done at the display layer.* A filter that
  splits one human in two is the same defect, and it would have been the
  precedent #133(d) and #144 copied.

**Consequences.** `?ownerName=` deep links no longer select; the param is simply
ignored. The token is opaque to a human reading the URL — accepted, because the
funnel's label is where a person is read, and the URL's job is to survive being
copied. design.md §6 now states which key applies when, so the next person column
does not have to re-derive it. When `ActionItem.assignedTo`'s readers move onto
`assignedToPersonId`, its funnel follows this rule rather than reopening it.

**Receipts.** #127 E7 · spec #124 §1 Class 4 · builds on `9e54165` (E6, the FK and
`requireOwner`) · design.md §6 amended in the same PR.
