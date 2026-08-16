---
status: accepted
date: 2026-08-15
supersedes: ""
superseded-by: ""
extends: an-insight-separates-symptom-from-action
extended-by: a-flagging-surface-computes-the-relationship-it-claims
tags: [insights, critical-chain, ui, ecosystem, i18n]
---

# A portfolio panel consumes the per-record diagnosis; it shares the computation, not the sentence

**Context.** `/ecosystem-summary`'s "Flow Constraint Diagnosis" named the phases sitting on
a live critical chain and how many programs each gates — **where**, not **why** or **for
how long** — under a heading promising otherwise. It was also the third thing on that page
saying "there is a problem", after the Attention Leaders banner and the Programs table's
Health column, and the only one of the three with machine-derived structure behind it.

Meanwhile `chainLedger` had already computed the answer. Its `Situation` union carries
`overPct`, `elapsedDays` vs `plannedDays`, idle days between a baton landing and being
picked up, and who is contended — and it rendered in **exactly one place**,
`ChainLedger.tsx`, one program at a time. So the app could already say "Integration is 40%
over its plan and contended with two other programs", just never on the page where somebody
is choosing which program to look at.

**Decision.** The panel consumes the diagnosis rather than re-deriving it, and the sharing
boundary is drawn at the COMPUTATION, not the sentence.

1. **One producer.** `lib/chainInsights.constraintDiagnosis` is the only place a
   `Situation` becomes a diagnosis. It reads the ledger's own packets — the panel never
   looks at phases, progress or dates — and returns an `Insight`, the shape this record
   extends. That producer decides severity, `basis`, `since`, and which of several
   findings on one phase is the worst.
2. **Prose is per surface, deliberately.** ChainLedger's bullet is about a PHASE on a page
   where the program is a given, and it fuses symptom with recommendation. The panel's
   cell is about a PROGRAM on a row whose header is already the phase name, and it states
   the symptom only. One string cannot serve both without either repeating the row header
   in every cell — the defect removed from the program page one change earlier
   ([ADR: A restated fact becomes a link](2026-08-15-a-restated-fact-becomes-a-link-and-a-count-links-to-the-set-it-counted.md)) —
   or dropping the program the diagnosis belongs to.
3. **The clean case is a row.** "On the chain, nothing wrong" is a first-class answer.
   Dropping it would overstate the portfolio, and it makes every remaining row read as
   trouble. It is kept SHORT, because a healthy portfolio prints it a dozen times.
4. **`basis` is rendered, per row, as provenance — never as the ✦ mark.** A row says
   "against a typed-in estimate" or "measured from recorded dates" in muted ink beneath
   the sentence. ✦ flags authorship of PROSE (design.md §8); reaching for it here would
   launder a derived number as an opinion. The vocabulary itself is explained once, in the
   section's ⓘ, rather than hedged into every sentence — which is the structural answer
   to [#140](https://github.com/alwaysmap/autoknow/issues/140)'s open question D, and the
   precedent that issue should copy.
5. **Severity leads the order**, then gating count, then name. A phase 40% over that gates
   two SOPs is a worse read than a healthy phase gating four, and the old count-only order
   buried it. `INSIGHT_SEVERITY_RANK` is exported so a surface that groups by something
   else first still agrees with `compareInsights` about which severity is worse.

The three-voices overlap is resolved by this panel being the one that EXPLAINS: the banner
and the Health column report a human needle, and this reports machine structure and now
says what the structure means.

**Alternatives rejected.**

- **One row per phase-in-program, rendering ChainLedger's sentence verbatim.** It would
  make the prose literally shared — and it would destroy the phase-NAME rollup
  ("Compliance Testing is gating four SOPs"), which is the one genuinely new fact this
  panel contributes.
- **A duration for the phase name across programs.** "Integration takes 60 days" averaged
  over four programs is the asserted-not-computed claim this family of issues exists to
  remove. Per-program, in the worst row, or not at all.
- **A "getting worse" column from `fourWeekDeltaDays`.** It is in the issue's goal and it
  is deliberately absent: that number is the PROGRAM's buffer trend, not the phase's, and
  attributing it to the phase would be the same defect one column over. A phase-level
  trend needs history this app does not keep.
- **Merging the three voices into one ranked "what needs attention" surface.** The issue
  floats it. It is a much larger change, it would swallow #140's surface as well, and
  nothing yet says the needle and the machine structure should share a list.
- **Dropping `sunkOverrun` handling silently.** It is excluded with a reason: a finished
  phase cannot BE the live constraint, so a row citing one would name one phase and
  diagnose another.

**Consequences.** `LiveConstraint` grows `diagnoses` and `worst`; the panel grows two
columns (Why, Since) and stays clear of horizontal page scroll at 360/768/1024. No new
query — `getEcosystemDashboardData` was already loading every program's ledger for the
busiest-resources aggregation and throwing the situations away. Eleven new i18n keys ×
four locales. `Insight`'s `action` is produced but not yet rendered here: the panel is a
diagnosis surface and the recommendation already has a home on the program page — the
field is populated so a future consumer does not have to re-derive it.

**Receipts.** Issue #148, the Insight shape's first real caller (the shape shipped with
`tests/insight.test.ts` expressing three producers against it and no live consumer, by
that issue's own "a shape validated by one caller is a guess"). Guards:
`tests/chainInsights.test.ts` (each situation's symptom, its basis, its `since`, worst-wins
when a phase has more than one thing wrong, `since: null` for a phase that has not started,
and that a finished phase is never described) and `tests/constraint_diagnosis.spec.ts` (a
seeded portfolio with one over-running phase AND one clean one — otherwise only half the
states are ever seen). Signed off from screenshots in both themes on the demo seed, which
renders both states and both bases.
