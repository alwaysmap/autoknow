---
status: accepted
date: 2026-07-29
supersedes: ""
superseded-by: ""
extends: forecasts-derive-from-the-real-chain-never-a-synthetic-model
extended-by: ""
tags: [summaries, gemini, critical-chain, data-integrity, staleness]
---

# A brief derives from the computation the page renders, and goes stale when that computation moves

**Context.** The program brief and the page under it computed different
schedules. The brief's evidence came from `computeCriticalChain`, whose
constraint is the *first unfinished phase on the path*; the page's red headline
and buffer ledger came from `computeChainLedger`, whose constraint is the *worst
estimate-overrun*. Same word, two meanings, one screen. On Ford Evos the ledger
said *est. Oct 18, 17 days late, act on Car Service Integration (117% past
estimate, 41 buffer days)* while the brief two inches above said *Audio HAL, 39
days over* and never mentioned Car Service Integration at all — the page's single
biggest fact was absent from the brief because per-phase overruns, buffer
consumption and projected finish were never in the evidence. Four of eleven
production briefs carried a constraint identity the page disagreed with.

Staleness could not catch it either. A brief was stale only when a *row was
added* — a state filed, a document ingested. Time passing and the chain drifting
underneath counted for nothing, so Qualcomm's nine-day-old brief sat beside a
header computing 5 days while it said 12, and nothing fired.

**Decision.** Two rules, and the second is what makes the first stay true.

1. **One computation.** A program brief's schedule evidence comes from
   `computeChainLedger`, via the same `getProgramLedgers` bundle the page uses —
   immediate focus, per-phase realized and forecast overruns, idle handoffs,
   where the buffer went, projected finish. The two constraint ideas keep
   *separate words* in the evidence — "the next unfinished phase on the chain"
   versus "the phase to act on today" — because the model copies the vocabulary
   it is handed.
2. **The brief stores the schedule it was written against**, as a four-field
   fingerprint on `Summary.chainFingerprint` (constraint phase, focus phase,
   buffer days, projected finish). A read compares it against the freshly
   computed chain and marks the brief **stale** when an identity changes or a day
   number drifts by `CHAIN_DRIFT_DAYS`.

**The drift is never shown to the reader.** There is no reason to display that
two numbers on one screen disagree when the honest answer is to refresh the older
one. Marking it stale is the whole mechanism: `SummaryPanel`'s mount effect
regenerates a stale brief on view and `runSummaryCycle` sweeps stale targets, so
this shipped with **no new UI**.

**Alternatives rejected.**

- **Show the disagreement** — a "this brief predates the current schedule"
  banner. It tells the reader we know the brief is wrong and leaves it on screen;
  the reader still cannot act on either number.
- **Reconcile by renaming only** — teach the prompt that "constraint" means the
  ledger's. The vocabulary was half the bug; the other half was that the overrun,
  buffer and projected-finish numbers were not in the evidence at any name.
- **Time-based staleness — stale after N days regardless.** Regenerates quiet
  programs for nothing and still misses a fast replan on day one. The issue
  allowed it as a first slice; the fingerprint is the honest trigger and is
  nearly free once the ledger is loaded anyway.
- **Recompute the whole chain per target inside the cron's staleness pass.** That
  is the N+1 the seven portfolio-wide aggregates exist to have removed. Instead
  the sweep adds exactly two set-based queries: one `DISTINCT ON (targetId)` for
  the newest fingerprint per program, and one `getProgramLedgers()` for every live
  program.
- **A fingerprint for partner and ecosystem scope too.** One chain cannot stand
  for many; those scopes keep the new-content test they already had.

**Consequences.** `Summary` carries a nullable JSON column, so every brief
written before this has no baseline — and **no baseline means no drift verdict**,
never "drifted", or the first read after deploy would regenerate the whole board
at once. Program-scope `getSummary` costs two extra queries when the
new-content probes come back clean, and the panel now regenerates on a schedule
that moved rather than only on a row that appeared: at `CHAIN_DRIFT_DAYS = 7`
that is at most one regeneration per program per week from drift alone, ~1.6/day
across eleven programs, inside the cycle allowance. It also commits the brief to
the ledger's definition of a constraint — if the page's headline changes its
mind, the brief follows, which is the point.

**Receipts.** GitHub #236 findings 4 and 6 (eleven production briefs read end to
end), epic `autoknow-u46.2`, bead `autoknow-6ys`. `src/lib/chainFingerprint.ts`,
`src/lib/summaries.ts`; `tests/chainFingerprint.test.ts`,
`tests/summaryChainDrift.test.ts` ("a replan that files NO new state row still
marks it stale"). Verified on the demo server 2026-07-29: the regenerated brief
says "59 days of buffer" and the Critical chain section below it says the same.
