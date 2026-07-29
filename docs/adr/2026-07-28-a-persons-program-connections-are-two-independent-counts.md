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
`src/lib/personPrograms.ts`). A row can be both, and shows both boxes.

The two surfaces classify the same three routes (TEL ownership, phase role,
action item) through two DIFFERENT computations, not one shared function —
this PR was rebased onto #144 (`via: ProgramRoute[]`, whether a connection is
LIVE or ENDED), which already classifies those same three routes per row
while assembling the full Programs table asynchronously (a DB round trip per
person, for `phaseFinishTimes`). `personProgramRows` derives
`connectionKinds` straight from that row's `via` Set — one place decides
which routes reached a project, and `connectionKinds` regroups its output.
`personProgramCounts`, the list page's count, cannot reuse `via`: the list
renders every person on one page load, and a DB round trip per row there is
the cost #144's design deliberately avoids for the *table*. It re-classifies
the same three routes synchronously via `ledProjectIds`/`involvedProjectIds`,
kept honest not by shared code but by a pinned fixture in
`tests/personPrograms.test.ts` asserting the two computations still agree.

**Alternatives rejected.**
- *Keep one union count, add the TEL route to it* — restores the old failure
  mode's shape: a reader still can't tell from "7" whether that means 7 led, 7
  involved, or a mix, and this issue's discrepancy would look fixed only until
  the next person with a different split.
- *Partition mutually exclusive (a row counts as EITHER led OR involved)* —
  false to the data: a TEL can also hold a phase role on their own program,
  and forcing an either/or would silently drop one of two true facts about
  that row.
- *Make `personProgramCounts` reuse `personProgramRows`/`via` directly* —
  rejected on cost, not principle: `via` only exists after the async
  per-row assembly (`phaseFinishTimes`'s DB round trip), and the list page
  renders every person in one page load. Paying that cost per row just to
  extract a count would make the list slower for a benefit the list doesn't
  need (the finish-date-derived `status`/`endedOn` fields it never renders).

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
