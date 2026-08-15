---
status: accepted
date: 2026-08-15
supersedes: ""
superseded-by: ""
extends: a-portfolio-panel-consumes-the-diagnosis-it-cannot-restate
extended-by: ""
tags: [ecosystem, critical-chain, resourcing, ui, confidence]
---

# A flagging surface computes the relationship it claims, states the count, and asks rather than concludes

**Context.** `/ecosystem`'s "Possible Resource Constraints" named the right subject and
could not support a resourcing decision. Four specific things were wrong, and only the
first is a bug in the ordinary sense:

1. Its intro claimed *"one calendar driving many SOPs"* while `BusiestRow` carried **no
   time data at all** — so "at once" meant "appears in these programs", and two programs
   needing Priya in Q1 '27 and Q4 '28 rendered identically to two that both needed her
   next month.
2. Rows sorted by `exposure` — `Σ buffer-loss × volume`, a product of two incommensurate
   units — which was never displayed. The order was the only signal and its basis was
   invisible.
3. "Marcus is on 3 programs concurrently" is the row's most decision-relevant fact and
   existed only as a count of links the reader made by eye.
4. The advice was day-precise and phrased as a conclusion ("shifting it protects the
   falling SOPs at the least cost") over durations compounded from typed-in estimates.

The issue was filed deliberately decision-open. These are the answers.

**Decision.**

1. **Compute the overlap.** Each program's claim on a resource is now a dated window —
   the hull of the schedule rows of the unfinished chain phases they are named on — and
   `peakOverlap` sweeps them for the largest simultaneous demand. `peak: null` is a REAL
   answer and the row says *"their windows never meet"*. Concurrency is the peak count,
   **not** the number of programs: three sequential demands and three simultaneous ones
   were the same row before and are opposite decisions now. An end and a start at the same
   instant is a handoff, not a collision.
2. **Rank by what is shown.** `exposure` is deleted. Rows sort by over-commitment, then
   concurrency, then how many SOPs they gate — every term of which is a column.
3. **Person and partner differ in STRUCTURE.** `CONCURRENCY_THRESHOLD` is 2 for a person
   (one calendar) and 3 for a company (many people), so the same count is a finding in one
   row and a staffing question in the next. Kind is a filterable class column, not a
   difference visible only in the wording.
4. **Confidence is stated once, structurally** — the section's ⓘ, the pattern
   [#148 set](2026-08-15-a-portfolio-panel-consumes-the-diagnosis-it-cannot-restate.md) —
   and the advice is phrased as a question. Where there is nothing to suggest, the row
   SAYS "flagged as an ecosystem risk, no recommendation" instead of going quiet.

**Alternatives rejected.**

- **A per-row overlap strip (the issue's option a1).** The most evocative answer, and it
  buys a new chart: SVG text driven by data needs its own de-collision pass and a crowding
  fixture in the same PR (AGENTS lesson 19), and the number is what the decision actually
  turns on. Columns first; a band is a follow-on with its own budget, not a rider on this.
- **Keep `exposure` as a hidden tiebreak.** An unreadable scalar is not improved by being
  demoted; it is improved by being deleted. Volume survives where it is legible — the
  "which program gets their time" tiebreak names the program, not a product.
- **Round every derived day-count to weeks.** Tempting, and it would put a second spelling
  of one fact into the app one change after a branch spent three commits removing exactly
  that. The basis statement carries the uncertainty; the numbers stay at the precision the
  surrounding columns use.
- **Drop partners from the section.** Floated by the issue. A company several programs
  lean on at once is worth flagging — it is just a different question, which the threshold
  and the verdict now express.
- **Separate tables per kind.** Two tables to express one difference, and it would make
  the ranking incomparable across the thing the section is for.

**Consequences.** `BusiestProgramInput.resources` and `ProgramLedgerBundle.chainResources`
carry `startMs`/`endMs`; `BusiestRow` gains `demands`, `peak`, `concurrent`,
`overCommitted` and loses `exposure`. No new query — the windows come from
`ledger.schedule`, which the aggregation already had in hand. The table gains two columns
and a Kind funnel; it clears horizontal page scroll at 360/768/1024/1440 in both themes and
both styles.

One shared primitive changed on the way: `AnchoredPopover` guards `matches(':popover-open')`.
That selector is one an engine either knows or **throws** on, and jsdom throws — so adding
a single filterable column took down four unrelated jsdom tests with an `AggregateError`
naming no cause. A thrown selector means there is no native popover to close, which is
exactly `false`.

**Pattern sweep.** `grep -rn "clConsider" src/`, plus every consumer of
`fourWeekDeltaDays`/`bufferDays` and every surface rendering a derived day-count:

- **`SopOutlookCell`** — its own header already argues that the text is "a quantity, not a
  verdict" and it already rounds to weeks. The issue asked whether that rounding was
  deliberate or coincidence: it is deliberate. Exempt.
- **`lib/summaries`** — feeds day counts into the brief prompt, prefixed "about". It
  reports quantities to a model rather than issuing advice to a reader. Exempt.
- **`ProjectMetaHeader` / `ChainLedger`** — the per-program page, where day counts sit
  beside a day-scaled chart of the same buffer. Exempt; the defect was the ADVICE, not the
  precision.
- **"Attention Leaders"** — a count of stated healths, deriving nothing. Exempt, as the
  issue predicted.
- **"Flow Constraint Diagnosis"** — rebuilt in #148 one commit earlier and now carries a
  per-row `basis` plus a section ⓘ. It is the precedent this section copies rather than a
  divergent instance.

**Receipts.** Issue #140. Guards: `tests/chainLedger.test.ts` (the peak sweep, `null` when
windows never meet, concurrency 1 rather than N for sequential demands, the two thresholds,
and a handoff not counting as a collision), `tests/ecosystemUrgency.test.tsx` (the number,
the window, the honest null, the structural kind split, the spoken no-recommendation, and
the interrogative mood), and `tests/busiest_resources.spec.ts` — new, because the windows
have to survive the whole path from `Phase` rows through the schedule to the page, which
no jsdom fixture can prove. Signed off from screenshots at 1440 in both themes × both
styles on the demo seed, where the top row reads "5 at once — one calendar, Aug 25 2026 –
Aug 26 2026": five programs whose windows all meet for two days, which is a true and
useful thing the section could not previously say either half of.
