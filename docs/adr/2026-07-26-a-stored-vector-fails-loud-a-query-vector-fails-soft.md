---
status: accepted
date: 2026-07-26
supersedes: ""
superseded-by: ""
extends: ""
extended-by: ""
tags: [ingestion, embeddings, data-integrity, gemini, search]
---

# A stored vector fails loud; a query vector fails soft

**Context.** The project hit a monthly Gemini **spend cap** — every call answering HTTP
429 / RESOURCE_EXHAUSTED. `embedText()` caught every failure and returned
`generateDeterministicEmbedding`, and `lib/refresh` wrote that result in the same
transaction as the new digest and `contentHash`. So a re-ingest during the cap replaced
a healthy row's real vector with the fallback, then set `contentHash` to match the new
content — after which Gate 1 reports `'unchanged'` on every later cycle and the row is
**never re-embedded**. The fallback is not degraded semantics but anti-signal: all-positive
components, so any two score ~0.75 cosine whatever the text says
([note](../knowledge/fallback-embedding-is-a-uniform-pedestal-not-signal.md)). The result
was permanent, silent corruption of exactly the rows that were still being maintained,
with each row still looking healthy. The transaction had been written to stop a failed
embed stranding a row; the `catch` defeated it by turning a failure into a plausible
success.

**Decision.** The two uses of an embedding want opposite things from a failure, so they
are separate functions.

- `embedForStorage` — for anything about to be **persisted**. It substitutes the fallback
  only when Gemini is *unconfigured* (a deployment with no key has no real vectors to
  damage, and is uniformly non-semantic). When a model is configured and the call fails it
  **throws** `EmbeddingUnavailableError`, carrying `quota` so a caller can stop a batch
  rather than grind. Callers abort before writing and the existing row survives untouched.
- `embedForQuery` — for a **transient** query. Returns null, and the caller ranks
  lexical-only. Refusing to search because a cap was hit would be its own outage.

Two supports: a central `callWithQuotaLatch` around every API call, so quota state is
maintained in one place rather than at five call sites; and a preflight — interactive
"update" entry points consult the latch and **decline before mutating anything**, so the
user is told nothing was changed instead of discovering a half-finished write.

**Alternatives rejected.**

- *Keep the fallback, mark the row for re-embedding.* Needs a new column and a sweeper,
  and still writes anti-signal that search serves until the sweep runs.
- *Write the digest but leave the vector alone on failure.* This is the stale-vector case
  the transaction already rejected: `contentHash` advances, so nothing ever retries.
- *Retry the embed inside `embedText`.* A spend cap is not transient; retries spend
  nothing and delay the honest failure.
- *One function with a `fallback: boolean` flag.* Same call, two meanings, decided by
  whichever caller last thought about it — the defect being fixed, parameterised.

**Consequences.** A refresh cycle during a cap now fails its sources loudly and carries
them over, which is louder in the logs and correct. `embedForStorage` throwing is a new
error path every persisting caller must handle. Rows poisoned *before* this change cannot
self-heal, so `npm run db:embeddings:audit` finds them by L2 norm (≈16 for the fallback,
≈1 for a real vector) and `-- --fix` clears them for re-ingestion. The quota latch is
per-instance and TTL'd, so it is a cache of the API's state and never authoritative.

**Receipts.** Spend-cap 429 reported 2026-07-26 with the instruction "check if i have
capacity *first* … don't break or invalidate the existing RAG entry". `src/lib/gemini.ts`,
`src/lib/geminiQuota.ts`, `src/lib/search.ts`, `src/lib/refresh.ts`, `src/lib/ingest.ts`;
`tests/embedNeverPoisons.test.ts`; `scripts/db/audit-embeddings.ts`.
