---
status: accepted
date: 2026-07-26
supersedes: ""
superseded-by: ""
extends: ingestion-health-is-a-serverless-signal-not-a-growing-table
extended-by: ""
tags: [ingestion, gemini, cost, budget, summaries]
---

# One Gemini budget, spent by every automated consumer in priority order

**Context.** The operator hit a real Gemini quota cap and assumed CI was spending the
key. It was not, and structurally cannot: no workflow sets `GEMINI_API_KEY`, jest
deletes it before any import (`tests/no-live-gemini.ts`), Playwright blanks it per
worker, and every page is `force-dynamic` so `next build` never calls out. The spend
was the hourly cron. #38 bounded ingestion — `dailyReingestBudgetDocs ×
GEMINI_CALLS_PER_DOC`, 120/day at the shipped defaults — and the Manage → Sources
slider plotted that against a 250/day tier as under half. But `/api/cron/refresh`
then called `runSummaryCycle()` *outside* that budget, under a private
`MAX_SUMMARIES_PER_CYCLE = 10`; hourly, that is up to **240 further requests/day the
gauge could not see**. A default install read "48% of the free tier" while its
ceiling was ~360 against 250. A second instance of the same shape: a budget of 0
floored to 1 doc/cycle — 48 requests/day — beside a readout saying 0.

**Decision.** One allowance per cycle, denominated in **requests**
(`perCycleRequests`), spent by every automated consumer in a fixed order: Drive
discovery, then web refresh, then whatever summaries the remainder buys. The figure
the slider plots is exactly the ceiling the cron enforces — not a partial tally. Zero
means off. Human-initiated calls (a search embedding, a Regenerate click, a
quick-ingest) are deliberately **outside** the pool, and the settings copy says so
rather than letting the slider imply otherwise.

Freshness is served before synthesis because a summary is derived from ingested
content: ingesting new content beats re-summarising stale content. The ordering is
self-balancing — unchanged documents short-circuit before any Gemini call, so a quiet
cycle hands its entire allowance to summaries.

**Alternatives rejected.**

- *A second knob for summaries.* Two numbers that are each under the tier while their
  sum is over — the exact bug, with an extra dial to get wrong.
- *Cap summaries, leave the gauge as `docs × 2`.* Bounds the spend but keeps the
  plotted number a different quantity from the enforced one, and an authoritative
  number that is not the real one is what caused this.
- *Meter live spend against the API.* Needs a counter surviving scale-to-zero. The
  derived cap bounds spend with no meter, which is the [#38
  decision](2026-07-23-ingestion-health-is-a-serverless-signal-not-a-growing-table.md)
  and still holds.
- *Pull interactive calls into the pool too.* Refusing a user's explicit request to
  spend is a worse failure than the spend, and that spend is bounded by how fast a
  person can click. Naming the exclusion in the copy is the honest defence.

**Consequences.** The plotted figures move — 96/day at the defaults rather than 120,
free-tier marker at 143 rather than 125 — because they are now derived from the
per-cycle floor. The readout becomes a staircase (budgets in the same 24-doc band
plot alike); that is a true property of an hourly cron with an integer cap and is
shown rather than smoothed. Summaries can be starved by a busy ingestion cycle, by
design, and `SummaryCycleReport.budgetExhausted` distinguishes that from "nothing
needed doing". Interactive spend stays unbounded — only copy defends it, and a
deployment with heavy search use can still exceed the tier.

**Receipts.** Quota cap reported 2026-07-26. `src/lib/ingestBudget.ts`,
`src/app/api/cron/refresh/route.ts`, `src/lib/summaries.ts`;
`tests/ingestBudget.test.ts` ("one pool: ingestion and summaries share the cycle
allowance"), `tests/summaryCycle.test.ts` ("runSummaryCycle honours the cycle
allowance it is given"). Plan detail: `docs/INGEST_FRESHNESS_PLAN.md` §12.
