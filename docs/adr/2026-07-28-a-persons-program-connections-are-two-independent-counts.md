---
status: accepted
date: 2026-07-28
tags: [people, data-table, ui-design]
---

# A person's program connections are two independent counts, never one union

**Context.** #243: `/people`'s Programs column counted only phase involvements
and action items — `Set([...phaseInvolvements, ...actionItems].map(projectId)).size`
— while `/people/:id`'s own Programs table additionally unioned in TEL
ownership (`Project.ownerPersonId`). A person who leads a program with no
phase involvement vanished from the list's count while still appearing on
their own page: the demo seed's Dylan showed 2 on `/people` and 7 on
`/people/1` for the same person, reproduced 2026-07-28.

**Decision.** Leading a program (TEL ownership) and being involved in one (a
phase role or an action item) are different claims about a person, not two
routes into one number. `/people` counts them SEPARATELY — Programs Led,
Programs Involved — and `/people/:id`'s Programs table carries a Connection
column stating which claim(s) hold for each row (`connectionKinds`,
`src/lib/personPrograms.ts`). A row can be both, and shows both boxes. Both
the list's counts and the person page's per-row kinds are built by calling
the same two functions — `ledProjectIds`, `involvedProjectIds` — rather than
each independently re-deriving "leads"/"involved" from the raw routes, so the
two surfaces read one definition instead of two that happen to agree today;
`tests/personPrograms.test.ts` still pins a fixture as a regression guard.

**Alternatives rejected.**
- *Keep one union count, add the TEL route to it* — restores the old failure
  mode's shape: a reader still can't tell from "7" whether that means 7 led, 7
  involved, or a mix, and this issue's discrepancy would look fixed only until
  the next person with a different split.
- *Partition mutually exclusive (a row counts as EITHER led OR involved)* —
  false to the data: a TEL can also hold a phase role on their own program,
  and forcing an either/or would silently drop one of two true facts about
  that row.

**Consequences.** Any future person-connection surface reads two counts, not
one, and states which is which — the same pattern `/partners` already uses for
Active vs Lifetime Programs. `roleSummary` (the Role column) now carries only
the per-phase `PhasePerson.role` text; TEL moved out of it into its own
Connection badge, so a TEL-only row renders the Role column's existing dash
convention instead of a badge conflating "how attached" with "which role".

**Receipts.** `src/lib/personPrograms.ts` (`personProgramCounts`,
`connectionKinds`), `src/app/people/PeopleClient.tsx`,
`src/app/people/[id]/PersonProgramsTable.tsx`, `tests/personPrograms.test.ts`
("#243 connection kinds — leads vs involved"), GitHub #243.
