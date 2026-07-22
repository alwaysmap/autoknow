---
status: accepted
date: 2026-07-22
supersedes: ""
superseded-by: ""
tags: [scaling, ingestion, vectors, freshness, architecture]
---

# Ingestion is sized for hundreds of sources; declare the limits, gate the 10K rebuild

**Context.** `docs/SCALING_LIMITS.md` (advisory analysis, 2026-07-20, committed in
PR #51) stress-tested the ingestion + vector-store design against ~10K sources —
two orders of magnitude past the "hundreds" `INGEST_FRESHNESS_PLAN §6` was built
for — and found it breaks at that seam on four independent axes: Drive discovery
is an O(corpus) one-level sweep of native Docs only, throttled to 5/hr (~83 days
for a 10K first import); a Chat "room" is really one @mentioned thread's first 100
messages, snapshot-only; binary/media is structurally unindexable (but fails
safe, no OOM); and a 1-hour freshness SLA over 10K sources needs ~667× the
scheduler's ~15/hr capacity, while fighting fixed 6h/168h cadence floors, an
O(corpus) whole-watched-set read every tick, and three engines sharing one 300s
Cloud Run request. The analysis grounds every claim in code. What did **not**
exist was a *decision*: which limits we accept and declare, versus rebuild. This
record is that decision, so implementation issues follow from it rather than
racing it (issue #39's deliberate sequence: preserve → decide → implement).

**Decision.**

1. **The supported scale is hundreds of sources; the freshness promise is tiered
   and honest — not sub-hour.** The promise is what the fixed-cadence scheduler
   already delivers: trackers ~6h, generic web ~weekly, Drive covered per cycle,
   Chat snapshot (user-pulled). `SCALING_LIMITS.md` rec 1 — "declare the achievable
   SLA honestly" — becomes the product promise. We do not advertise sub-hour
   freshness over thousands.

2. **`INGEST_FRESHNESS_PLAN §6` is REAFFIRMED, with its reversal condition made
   explicit.** The "deliberately dumb" fixed-cadence scheduler stays; per-row
   `nextCheckAt`/AIMD is not rebuilt. §6 asked for "new evidence" before rebuilding
   adaptive scheduling — this record names exactly what that evidence is: **a
   committed product requirement for thousands of watched sources at sub-daily
   freshness.** Absent that commitment §6 holds; with it, §6 is superseded as part
   of the gated rebuild (decision 6), not piecemeal.

3. **Today's source-scope limits are ACCEPTED functionally but must be declared
   IN-PRODUCT** (AGENTS lesson 5) — a silent limit is indistinguishable from a bug.
   Drive watches native Google Docs, one folder level: skips and "N files below the
   watched level" become product signal, not a silent `report` field. Chat captures
   one thread's first 100 messages as a snapshot: the ack copy says *thread*,
   first-N, snapshot — never "room" or "watched". Binary/media is not indexable: a
   typed, honest message ("video isn't indexable") replaces a leaked Drive 403, and
   a size ceiling at the boundary makes no-OOM a guarantee, not an accident. A
   source truncated past `MAX_DOC_CHARS` (30K) is flagged lossy.

4. **No chunking now.** One source = one digest = one 768-dim embedding stays.
   Chunking is a retrieval-quality change forced only by media indexing (out of
   scope), so it is deferred; the 30K truncation is made *visible* (decision 3),
   not removed.

5. **The single 300s hourly request stays, and is a HARD SEQUENCING CONSTRAINT on
   throughput.** Three engines share it; raising any per-cycle cap to chase
   throughput blows the budget long before it closes the gap. So no cap increase
   ships until (a) the worker is decoupled from the request (a queue) and (b) the
   single-flight advisory lock the README advertises but does not implement
   actually exists — overlaps only become possible once a tick nears 300s. Until
   then the README is corrected to stop claiming a guard that isn't there (AGENTS
   lesson 10).

6. **The 10K corpus is a future, GATED program — not a cap tweak.** If the product
   commits to thousands of sources, it ships as a sequenced rebuild: Drive
   `changes.list` delta feed (the `SyncCursor` store already exists), DB-side
   due-source selection (indexed `LIMIT`, replacing the O(corpus) `findMany`),
   queue decoupling, per-row tiered scheduling (schema expand→backfill→contract per
   CHANGE_PLAYBOOK), HNSW + split lexical/semantic search branches, and infra
   right-sizing (infra PR + human `terraform apply` first). Each is its own issue,
   filed only when in scope; `SCALING_LIMITS.md §2/§5` is the standing candidate
   list so nothing is lost.

**Alternatives rejected.**
- *Promise the 1-hour/10K SLA and chase it by raising caps* — the caps are not the
  binding constraint; the 300s request, the O(corpus) selection read, and the
  cadence floors each defeat it independently, and a raised cap inside one request
  just approaches the ceiling. Promising it is the dishonest-SLA failure the
  analysis names.
- *Rebuild adaptive per-row scheduling now* — §6 deleted it deliberately for a
  hundreds-scale corpus; rebuilding it without the thousands-scale commitment
  re-adds the machinery the adversarial review removed, for a load that does not
  exist (AGENTS lesson 12: a review deletes mechanisms).
- *Expand source scope now (folder recursion, Chat room watch, media pipeline)* —
  each is a new connector or pipeline, not a cap change, and none is worth building
  before the scale that needs it. Declaring the current limits honestly is far
  cheaper and removes the real user-facing surprise (a silently-unwatched folder).
- *Silently keep the limits* — the status quo, and exactly what let a user believe
  a folder was watched when most of it was not.

**Consequences.** Implementation issues are filed from decision 3 (honest
in-product limits), decision 5 (implement the single-flight lock; correct the
README), and the scale-independent DB-selection fix; the decision-6 items are
tracked but uncommitted. `INGEST_FRESHNESS_PLAN §6` gains a pointer to this record
and its reversal condition; `SCALING_LIMITS.md` is reclassified from open analysis
to the grounding of this decision. Issue #38 is reconciled against
`SCALING_LIMITS.md` (it cited one cap where there are four, omitted the 300s
ceiling, and missed the no-chunking / 30K constraint) or closed in favour of the
issues above. Because the limits are now a stated promise, honoring them in-product
— not only in this doc — is itself tracked work.

**Receipts.** `docs/SCALING_LIMITS.md` (analysis; committed PR #51). Issue #39.
Cap/ceiling figures — 5/5/10/10 per cycle, one 300s request, 30K chars, ~15/hr vs
~10K/hr ≈ 667×, ~10K-row ANN threshold — cited from code in `SCALING_LIMITS.md`
§0/§5 at analysis time. `INGEST_FRESHNESS_PLAN §6` is the reaffirmed decision;
this record supplies the "new evidence" clause it asked for.
