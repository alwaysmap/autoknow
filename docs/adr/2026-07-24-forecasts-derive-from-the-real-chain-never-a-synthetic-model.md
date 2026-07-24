---
status: accepted
date: 2026-07-24
supersedes: ""
superseded-by: ""
extends: ""
extended-by: ""
tags: [forecast, ui, data-integrity, charts, critical-chain]
---

# A forecast on screen derives from the real plan; a synthetic model is deleted, not kept beside it

**Context.** `lib/forecast.ts` ran a Monte Carlo over the *number* of unstarted
phases, drawing each from a fixed `normal(12, 4)` floored at 3 days and seeded by
project id. It read no phase duration, no dependency, no buffer — so two programs
with the same phase *count* produced the same "forecast", and no change to an
actual plan could move it. `/ecosystem` diagnosed this and replaced its column
with `sopOutlook` off the real critical chain, leaving a comment saying the
placeholder *"said '+16 days likely' on nearly every row"*. **The sweep stopped at
that file.** The same generator remained on `/ecosystem-summary` under the label
"Completion Forecast (p85)" — this time as a **sortable** column, so a leader
could rank the portfolio by a number that was a function of phase count and
nothing else — and on `/programs` as dead plumbing behind an interface. That is
three sites, two labels, one generator (AGENTS lesson 7).

**Decision.** Any number presented as a completion forecast derives from the real
plan: `criticalChain.remainingDays` against the SOP target, via
`sop.sopOutlook`. There is no synthetic fallback. `lib/forecast.ts` and every
`forecast.sim` field are **deleted**, not retained beside the real computation —
retaining the superseded variant is precisely how it reached a second page and a
third file. Where there is nothing to compute, the surface says so (`TBD`,
`Finished`) rather than showing a plausible number.

**Alternatives rejected.**

- **Keep the Monte Carlo, relabel it "estimate".** The frame was never the
  problem; the number was. A relabelled invented number is still sortable.
- **Keep it as a fallback when chain data is thin.** That reintroduces "plausible
  value where there is no reading", which is the same defect one level down —
  and it is what left the module alive to recur.
- **Mark it with the ✦ AI-provenance mark** (design.md §8). ✦ means "a machine
  wrote this prose". A derived-but-real number, an invented one, and an AI summary
  are three different things; using ✦ here would launder the third as the first.

**Consequences.** `/ecosystem`, `/ecosystem-summary` and `/programs` now answer
the SOP question the same way, from one helper. The sort key
`forecast.sim.p85` is gone; `chainRemainingDays` replaces it, and it is a real
quantity, so sorting means something. `/ecosystem`'s header was additionally
sorting on `key: 'forecast'` — an object — which was silently meaningless and is
now `chainRemainingDays` too. A future forecast that carries genuine variance
(see `docs/CRITICAL_CHAIN_VIEW_PLAN.md` §8) must state its basis; this ADR
forbids the basis-free version, not forecasting.

**Receipts.** Issue #129 (the sweep), PR for #129. Prior half-fix:
`EcosystemDashboardClient.tsx` comment on the `/ecosystem` column. Guard shipped
alongside: `tests/noFabricatedData.test.ts`, which fails if a seed entity name is
hard-coded into `src/app/**` or `src/components/**` — the disguise the companion
defect wore (a "Flow constraint diagnosis" panel built from five typed-in
literals).
