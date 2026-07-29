---
status: accepted
date: 2026-07-29
supersedes: ""
superseded-by: ""
extends: one-gemini-budget-pool-ordered-freshness-first
extended-by: ""
tags: [summaries, gemini, cost, budget, guards]
---

# A prompt rule a machine can check is checked, and a violation buys exactly one retry

**Context.** Three rules of the brief contract were written down, and all three
were being broken in production, because the only enforcement was a
`console.warn` nobody reads. ISO dates in prose — banned explicitly by the VOICE
block and by design.md §6 — appeared in **4 of 11** briefs (*"on track for the
2027-02-15 SOP"*). Bracketed evidence ids appeared in prose, where a post-hoc
`stripIds` quietly repaired them, so a prompt regression laundered itself into a
clean-looking brief. And action bullets dropped the owner's parenthesized
company, which is the signal that says which SIDE a person is on — producing
*"Sarah Jenkins must drive the partner to debug the audio HAL cold boot freeze
deadlock"*, where Jenkins **is** the partner.

Prompt engineering had already been tried on all three. AGENTS lesson 2 is the
answer: a new rule ships its fail-closed guard, not a warning.

**Decision.** `mechanicalViolations()` is a pure function over the generated
brief, checking the three rules a text test can actually decide. A brief with
violations is **re-asked once**, with the broken rules named by field, and the
**better of the two answers is kept** — so a retry can only improve the result,
even when the second answer also breaks something. Never a loop.

Because a brief can now cost two Gemini calls, **the cron's allowance is spent in
requests, not in summaries.** `createSummary` returns `{ id, requests }` and takes
a `maxRequests` cap; `runSummaryCycle` decrements a request budget and passes
`min(2, remaining)`, so the last request of an allowance buys an attempt with no
retry rather than overdrawing. `SummaryCycleReport.requests` reports what was
actually spent.

**Alternatives rejected.**

- **Keep warning.** This is the state that shipped four ISO briefs. A warning is
  a rule nobody enforces plus a line nobody reads.
- **Retry until clean.** Unbounded spend against a real free-tier cap, for
  diminishing returns — and a model that broke a rule twice will break it a third
  time.
- **Drop the offending bullet, or repair it in code.** `stripIds` already does
  this for one rule and it is exactly what hid the regression: a laundered brief
  looks correct and teaches nobody. Repair also cannot work for the affiliation
  rule, where the missing fact is a fact.
- **Leave the cap counting summaries and accept a 2× worst case.** That breaks
  the invariant the one-pool ADR exists to hold: the figure the settings slider
  plots must be *exactly* the ceiling the cron enforces. A pool whose real
  ceiling is double the plotted one is the original bug with a new cause.
- **A stricter validator — banned-opener detection, subject-naming openers.**
  Real defects (~8 of 11 briefs open by naming the subject), but not mechanically
  decidable: "Ford Evos slips 17 days" is a good opener and "Ford Evos is a
  program with Ford" is not, and no cheap test separates them. Those stay in
  VOICE.

**Consequences.** A cycle can generate 4 briefs for 5 requests, so `generated`
and `requests` are now different numbers and the report carries both.
`GEMINI_CALLS_PER_SUMMARY = 1` is still the right unit for
`summariesAffordable` — it prices one *attempt* — but "one summary, one request"
has stopped being true, and the cycle spends the thing the ceiling is drawn in.
Human-initiated regeneration stays outside the pool, as that ADR decided, and may
spend its retry. The three checks are deliberately cheap text tests: the remedy
costs a Gemini call, so the check must never cost more than the thing it guards.

**Receipts.** GitHub #236 finding 5 and fix 6, bead `autoknow-6ys`.
`mechanicalViolations` in `src/lib/summaries.ts`; tests extended in
`tests/summaryProseDates.test.ts` (the existing prose-date lint, per the issue's
"extend it rather than duplicating") and `tests/summaryChainDrift.test.ts` ("the
cycle spends requests, so retries cannot push it past its ceiling").
