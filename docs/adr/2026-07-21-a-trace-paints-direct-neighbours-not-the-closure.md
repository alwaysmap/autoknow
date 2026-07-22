---
status: accepted
date: 2026-07-21
supersedes: ""
superseded-by: ""
tags: [ui, rail, graph, tufte]
---

# A trace paints direct neighbours; the closure only fades cards

**Context.** Selecting a phase on the rail originally lit every edge on any path
through it. That is the correct answer to "what could this ever reach" and a
useless one to look at: on the 15-phase AAOS template (23 edges) the closure lights
an average of **10.9 of 15** stations, and **15 of 15** for each of the first three
phases — selecting the first phase highlights the entire program. Four rendering
iterations followed (calmer tint, solid bands, opaque joins, palette separation),
each improving how a fundamentally over-broad selection was *drawn*, until the user
— who wrote the data model — reported they "literally cannot interpret the phase
tracks." The direct neighbourhood averages **4.1 of 15** instead.

**Decision.** The track paints only edges **touching** the selected phase
(`FocusSet.directKeys`). The transitive closure is still computed and still drives
card relevance (`data-rel` up/down/far), because "is this phase implicated at all"
is a different question from "what does it hand to, and take from." Bundling
partitions on what is **painted**, not on what is reachable: a branch line shared
between a traced and an untraced dependency must split, or the shared stem lights
whole and names phases that are ghosted.

**Alternatives rejected.**
- *Full transitive closure* — lights ~everything on a converging plan; it answers a
  question nobody asked while hiding the one they did.
- *Depth-limited N hops* — an arbitrary cutoff that still floods at the first
  fan-in (Compliance gates has 8 inbound) and now also lies about where it stopped.
- *Better rendering of the closure* — tried four times. The problem was the scope,
  not the ink; each pass made an unreadable answer prettier.
- *A text-only "related phases" list* — accurate, but discards the map, which is
  the reason the diagram exists.

**Consequences.** The rail answers "what does this touch" rather than "what could
this ever reach." Track scope and card scope are **deliberately different** — a
`far` card can sit beside unpainted track, which reads correctly (not implicated,
not directly connected) but means the two must never be described as one selection
in code or copy. Anything that needs the closure (impact analysis, "what slips if
this slips") must ask for it explicitly rather than read it off the picture.

**Receipts.** `470d7d6` (first trace), `d62844b` (bundles partition on painted ink,
after a shared stem lit whole and named faded phases), `ee8327c` (direct neighbours
+ hop-overs), PR #17. Figures re-derived from `src/lib/builtinTemplates.ts` at
record time — an earlier in-session estimate of "11 of 15 simple, closure paints
14 of 15" was wrong and is superseded by the numbers above.
