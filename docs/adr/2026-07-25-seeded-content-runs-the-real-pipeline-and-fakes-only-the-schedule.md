---
status: accepted
date: 2026-07-25
supersedes: ""
superseded-by: ""
extends: ""
extended-by: ""
tags: [seed, demo, ingestion, freshness, data-integrity]
---

# Seeded content moves through the real connectors, and a demo may compress the schedule but never a timestamp

**Context.** The mock seeder wrote its four ingested sources with a raw `INSERT`
(`lib/vector.ingestRecord`), so they carried no `sourceRef`, `contentHash`, `mode`
or revision. Nothing in the freshness path could act on them: `runRefreshCycle`
found nothing due, `/manage/sources` had nothing to show, and the activity feed's
`Updated: …` card — which reads `ContextRevision.delta` — **could not appear at
all**, in any demo, ever. The feed was therefore ~100% phase-and-project state
rows, which is why it read as nothing but buffers and dates. Widening the corpus
exposed the second half: a seeded source can never be re-fetched, because
`refreshSource` reaches Drive or the open web and the app cannot serve its own
fixtures either (localhost is inside the SSRF guard, `lib/sources.isForbiddenHost`).

**Decision.** Two rules, one principle — seeded data meets the system the way real
data does.

1. **Seeded content enters through the app's own ingest boundary** (`ingestContent`),
   never a direct write, so it is indistinguishable from a pasted source: same
   dedupe, digest, embedding, hash and initial revision. Re-fetching is a **fixture
   connector** — a `mock:` `sourceRef` branch in `lib/refresh` that serves the next
   authored revision — so every real gate downstream still runs. It is gated
   fail-closed on `destructiveDbAllowed()`, the signal that already means "this
   database is disposable".
2. **What a demo may fake is SCHEDULING, never a record.**
   `REFRESH_MAX_CADENCE_SECONDS` compresses the cadence table so a week of
   freshness passes in minutes; no row's data is touched.

**Alternatives rejected.**
- *Keep authoring digests directly* — cheapest, and it is what produced a demo in
  which the entire freshness feature was invisible and untestable by hand.
- *Serve the fixtures over HTTP from the app* — would need a localhost exemption in
  the SSRF guard, i.e. weakening a security control to make a demo nicer.
- *Backdate `lastCheckedAt` to force rows due* — **tried, and reverted from a
  working state.** It makes rows due without touching library code, and it makes the
  app report "checked 2026-07-17" about a source it checked four seconds earlier —
  in the activity feed and Manage → Sources, whose whole job is stating freshness.
  A demo that lies about freshness to demonstrate freshness is worse than no demo.
- *Ungated mock connector* — fixture prose in a real deployment would be embedded,
  summarized and cited in AI briefings as ingested fact (AGENTS lesson 5).

**Consequences.** Seeding costs real Gemini calls when a key is present (~3 per
document) and degrades honestly without one — with no key there is no `delta`, so
no `Updated: …` card. `lastCheckedAt`, `lastChangedAt` and `createdAt` are still
backdated at seed time, which is a deliberate exception: those are the *ingest
date* of authored history, not a claim about work the app performed. The fixture
bounds its own spend — once the authored revisions are exhausted every later cycle
short-circuits at Gate 1 and costs nothing.

**Receipts.** `tests/mockConnector.test.ts` (the fail-closed guard is its first
suite), `tests/refreshCycle.test.ts` "compresses the whole cadence table" and
"leaves the real cadence alone", `tests/seedMock.test.ts` "every ingested source
carries the freshness identity the refresh cycle needs". Sibling in principle to
[A forecast on screen derives from the real plan](2026-07-24-forecasts-derive-from-the-real-chain-never-a-synthetic-model.md).
