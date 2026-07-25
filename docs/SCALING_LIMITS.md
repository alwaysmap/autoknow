# AutoKnow — Scaling Limits of Ingestion & the Vector Store

Status: **Analysis, now decided** (2026-07-20 analysis; decision 2026-07-22;
recommendation 6 shipped 2026-07-24, #57). This
grounds — but no longer precedes — a decision: [ADR: Ingestion is sized for
hundreds of sources; declare the limits, gate the 10K rebuild](adr/2026-07-22-ingestion-sized-for-hundreds-gate-the-10k-rebuild.md)
consumes this analysis, accepts the hundreds-scale limits and requires them
surfaced in-product (AGENTS.md lesson 5), and gates the 10K rebuild behind an
explicit product commitment. §2/§5 below are the standing candidate list for that
gated program. This still grounds every claim in the current code and
cross-references `docs/INGEST_FRESHNESS_PLAN.md` (the design it stress-tests) —
whose §6 the ADR reaffirms. Every scenario below is a variant of "what happens at
10K," two orders of magnitude past the hundreds §6 was built for.

---

## 0. How ingestion works today (the shared mental model)

The unit of ingestion is **one `ContextUrl` row = one source = one digest = one
768-dim embedding**. There is **no chunking and no per-chunk retrieval**:

1. Fetch the source's text.
2. Truncate to **`MAX_DOC_CHARS = 30_000` chars** (~7.5k tokens) —
   [`gemini.ts:22`](src/lib/gemini.ts), applied in `summarizeDocument`.
3. `gemini-flash-latest` distills it into a small structured **digest**
   (summary + topics + decisions + questions + `sourceStatus`).
4. **The digest** (not the document) is embedded into **one** `vector(768)`
   column via `embedText` — [`ingest.ts:141`](src/lib/ingest.ts).
5. Search is a **blended lexical + exact vector scan** with **no ANN index**
   — [`search.ts`](src/lib/search.ts); the schema header says this is fine "at
   the current scale (hundreds of rows)" and to add HNSW past ~10k
   ([`schema.prisma:11-18`](prisma/schema.prisma)).

Two revisiting engines run inside **one hourly Cloud Run request capped at 300s**
([`main.tf:321`](infra/terraform/main.tf), `cron_schedule = "0 * * * *"`),
sequentially: `runDriveSync()` → `runRefreshCycle()` → `runSummaryCycle()`
([`cron/refresh/route.ts:31-33`](src/app/api/cron/refresh/route.ts)). Per-cycle
caps bound every stage:

| Stage | Cap / cycle | Hourly throughput | File |
|---|---|---|---|
| Drive discovery (new docs) | `MAX_DISCOVERIES = 5` | 5 / h | [`driveSync.ts:28`](src/lib/driveSync.ts) |
| Drive refresh (changed docs) | `MAX_REFRESHES = 5` | 5 / h | [`driveSync.ts:29`](src/lib/driveSync.ts) |
| Web/tracker refresh | `MAX_REFRESHES_PER_CYCLE = 10` | 10 / h | [`refresh.ts:149`](src/lib/refresh.ts) |
| Summary regeneration | `MAX_SUMMARIES_PER_CYCLE = 10` | 10 / h | [`summaries.ts:457`](src/lib/summaries.ts) |

Infra envelope: **`db-f1-micro`** shared-core Postgres (~0.6 GB RAM, shared
vCPU — [`variables.tf:51`](infra/terraform/variables.tf)); Cloud Run
**default 512 MiB / 1 vCPU**, `max_instance_count = 2`
([`main.tf:323-324`](infra/terraform/main.tf)).

These four caps × 300s × hourly are the numbers every scenario below collides
with.

---

## 1. Scenario matrix (the short version)

| # | Ask | What actually happens | Verdict |
|---|---|---|---|
| **a** | Watch a Drive folder, 10K files in a **tree** | Only **direct children of the shared folder** are seen (1-level sweep); only **native Google Docs** ingest; throttled to **5 new docs/hr** → ~**83 days** to ingest 10K; sweep is **O(N) Drive calls every hour** | **Breaks** on 3 axes: nesting, file type, throughput |
| **b** | Watch a Chat **room** of 10K msgs | Only the **one @mentioned thread** is captured, first **100 messages**, then truncated to 30K chars; **`snapshot` mode = never scheduler-watched** | "Watch a room" is **unsupported**; "watch" is a no-op for Chat |
| **c** | Index one very large **binary** (video) | Skipped by the sweep (**MIME filter**), rejected by the paste path (**export-only**), rejected by web fetch (**content-type/2 MB guard**) — never downloaded | **Structurally unsupported** (but fails safe, no OOM) |
| **d** | 10K sources, revisit each **< 1 h** | Scheduler capacity ≈ **15 refreshes/hr** vs **10 000/hr** required (~**667×** short); cadence floors are **6 h / 168 h**; a full watched-set table read every tick | **Off by ~3 orders of magnitude**; the SLA is incompatible with the design |

---

## 2. Case (a) — Drive folder, 10K files in a tree, kept under watch

**Code path:** [`driveSync.ts`](src/lib/driveSync.ts), invoked first inside the
hourly cron.

### What happens
1. **Discovery is a full sweep, not a delta feed.** Every cycle lists
   `sharedWithMe = true and trashed = false` (paginated 100/page,
   [`driveSync.ts:35`](src/lib/driveSync.ts)), then for **each shared folder**
   does **one** `'<folderId>' in parents` listing —
   [`driveSync.ts:72-80`](src/lib/driveSync.ts). The code comment is explicit:
   *"one level of folder children … (documented limitation: one level)."*
2. **Type filter:** only `application/vnd.google-apps.document` proceeds; PDFs,
   Sheets, Slides, uploaded Office files, images, video → `skippedOtherTypes`,
   never ingested — [`driveSync.ts:82-84`](src/lib/driveSync.ts).
3. **Throttle:** at most `MAX_DISCOVERIES = 5` new docs ingested per cycle.

### The limits, made concrete
- **Tree depth = 1.** A 10K-file *tree* (folder → subfolder → files) exposes
  only the direct children of the shared root. Anything one subfolder deep is
  **invisible** — no error, no signal. This is the single biggest correctness
  surprise: the user believes the folder is watched; most of it isn't.
- **Type coverage.** A typical Drive folder is mostly *not* native Docs, so even
  the visible level is largely skipped. `skippedOtherTypes` is counted but never
  surfaced to the user.
- **Ingest throughput.** Even in the best case (all 10K are top-level native
  Docs), 5/cycle × hourly = **120/day → ~83 days** to ingest once. The comment
  *"the hourly cadence drains any backlog fast"* holds at hundreds and is
  ~200× wrong at 10K.
- **Per-cycle cost is O(corpus), forever.** 10K files = ~100 paginated
  `files.list` calls **every hour**, plus one call per shared subfolder — whether
  or not anything changed. `SyncCursor` (the `changes.list` pageToken model) is
  defined in the schema but **unused** by this path.
- **300s budget pressure.** ~100 sequential list calls + 5 doc exports + 5
  Gemini summarize+embed can approach the 300s request cap on their own; when
  `runDriveSync` overruns, `runRefreshCycle` and `runSummaryCycle` in the *same
  request* are starved.

### Recommendations
- **Switch discovery to the Drive `changes.list` delta feed** (the schema's
  `SyncCursor` is already the store for the pageToken). One delta call per cycle
  covers the whole corpus and is O(changes), not O(corpus). This is the plan's
  own stated Gate-1 intent (`INGEST_FRESHNESS_PLAN §4`); the sweep was a v1
  shortcut valid only at small scale.
- **Recurse the tree** (bounded depth + file cap) or, better, subscribe at the
  folder and let the delta feed report descendants; drop the "one level" limit or
  **declare it in the UI**.
- **Make skips visible:** return `skippedOtherTypes` and "N files below the
  watched level" as product signal, not a silent `report` field (lesson 5).
- **Decouple discovery throughput from the 300s request:** move backlog ingest to
  a queue/Cloud Tasks worker so a 10K first-import isn't rationed at 5/hour inside
  the cron tick.

---

## 3. Case (b) — Chat room of 10K messages, growing, kept under watch

**Code path:** [`chatEvents.ts` `handleChatEvent` / `fetchThreadText`](src/lib/chatEvents.ts).

### What happens
- Ingestion is triggered by an **@mention**, and it captures **the thread**, not
  the space: `filter: thread.name = "<threadName>"` with **`pageSize: 100` and no
  pagination loop** — [`chatEvents.ts:171-174`](src/lib/chatEvents.ts). Only the
  **first 100 messages** of that one thread are read.
- Those messages are joined and then truncated to **30K chars** in
  `summarizeDocument`.
- Chat rows are **`snapshot` mode** — [`chatEvents.ts:241`](src/lib/chatEvents.ts),
  and `INGEST_FRESHNESS_PLAN §5.1`: *"Chat stays snapshot — freshness is
  user-pulled."* The scheduler **never** re-checks them; `runRefreshCycle`
  filters to `mode: 'watched'` only ([`refresh.ts:161`](src/lib/refresh.ts)).

### The limits, made concrete
- **A "room" is never ingested.** A 10K-message space is many threads; AutoKnow
  captures only the single thread it was mentioned in. There is no space-level
  history walk and no message-created subscription.
- **Even that thread is capped at 100 messages** and further gutted by the 30K
  char truncation. A long thread loses everything past the first 100 / first
  ~7.5k tokens.
- **"Keep under watch" is a no-op for Chat.** The *only* refresh path is a human
  re-@mention, which writes a `ContextRevision` (again: first 100 messages, hash-
  gated) — [`chatEvents.ts:219-234`](src/lib/chatEvents.ts). "Growing" is
  invisible to the system until a person acts.

### Recommendations
- **Paginate `fetchThreadText`** (loop on `nextPageToken`) and window/aggregate
  long threads instead of a single 30K-char truncation — otherwise long threads
  are silently lossy.
- **If room-level watch is a real requirement,** it needs a different mechanism: a
  Chat **space subscription / `messages` events** feed (Workspace Events API) with
  incremental ingest, plus a rolling-window or per-N-messages digest strategy.
  That is a new connector, not a cap change.
- **Set expectations in the ack copy:** today's reply says "I'll save its thread";
  it should say *thread*, first-N messages, snapshot — so users don't assume the
  room is under live watch.

---

## 4. Case (c) — index a single very large binary (e.g. one big video) in Drive

**Code paths:** [`driveSync.ts:82`](src/lib/driveSync.ts) (MIME filter),
[`google-docs.ts:16-26`](src/lib/google-docs.ts) (`export?mimeType=text/plain`),
[`ingest.ts:321-326`](src/lib/ingest.ts) (web content-type guard).

### What happens — three independent rejections, all fail-safe
1. **Sweep:** a video's MIME (`video/mp4`, …) ≠ `DOC_MIME`, so it's counted in
   `skippedOtherTypes` and never touched.
2. **Manual paste (`ingestGoogleDoc`):** `fetchGoogleDocText` calls Drive
   `files/{id}/export?mimeType=text/plain`. **`export` only supports native Docs-
   editor files**; for an uploaded binary it returns HTTP 403 and the ingest
   returns that error — the bytes are **never downloaded**.
3. **Generic web fetch:** `fetchWebUrl` rejects any non-`text/|json|xml`
   content-type and hard-caps the body at 2 MB
   ([`ingest.ts:322,326`](src/lib/ingest.ts)).

### The limits, made concrete
- Binary/video is **structurally unsupported** — there is no transcription, no
  audio/frame extraction, no OCR, no chunking of a resulting transcript. And a
  multi-hour transcript would still hit the 30K-char cap.
- The **positive** here: nothing tries to stream a multi-GB file into a 512 MiB
  Cloud Run container, so there is **no OOM path**. This safe-by-omission
  behavior is worth *preserving as an explicit guard* if a media connector is ever
  added.

### Recommendations
- **Keep the hard reject, but make it honest and typed:** classify unsupported-
  media and tell the user "video isn't indexable" instead of leaking a raw Drive
  403 (lesson 5 — degrade with an honest message).
- **If media indexing is wanted,** it is a separate pipeline: Speech-to-Text /
  video-intelligence → transcript → **chunk** (this is the first case that forces
  real chunking) → many `ContextUrl`/chunk rows → embeddings. Enforce a **max file
  size / duration** and stream to a bucket; never buffer bytes in the request.
- **Add a size ceiling at the boundary** for any future binary path so the
  no-OOM property becomes a guarantee, not an accident.

---

## 5. Case (d) — 10K sources, revisit each within a 1-hour freshness SLA

This is the crux, and it collides with the design head-on. `INGEST_FRESHNESS_PLAN
§6` says the scheduler is *"deliberately dumb"* and that AIMD/per-row scheduling
was **killed on review** because *"the corpus is hundreds of sources."* A 1-hour
SLA over 10K sources invalidates that founding assumption.

### The throughput gap (the headline number)
- Scheduler refresh capacity: web/tracker **10/hr** + Drive **5/hr** ≈ **15
  sources/hr** (Chat contributes 0 — snapshot).
- A 1-hour freshness SLA over 10K watched sources requires re-checking **10 000/hr**.
- **Deficit ≈ 667×.** Time for one full lap at current caps:
  - Web/tracker: 10K / 10 per hr = **1 000 hours ≈ 42 days**.
  - Drive: 10K / 5 per hr = **2 000 hours ≈ 83 days**.

### It's not only the caps — three more independent blockers
1. **Cadence floors fight the SLA.** `CADENCE_HOURS = { tracker: 6, web: 168 }`
   ([`refresh.ts:148`](src/lib/refresh.ts)). A web source is "due" only **once a
   week**; even with infinite throughput the code would never re-check it within
   an hour. The cadence table itself must change to honor a 1-hour target.
2. **The selection query loads the whole watched set every tick.**
   `runRefreshCycle` does `findMany({ where: { mode:'watched', frozenAt:null },
   orderBy: { lastCheckedAt:'asc' } })` with **no `take`**, filters "due" in JS,
   then processes 10 — [`refresh.ts:160-178`](src/lib/refresh.ts). `runDriveSync`
   likewise pulls **all** `drive:` rows into a Map each cycle
   ([`driveSync.ts:86-90`](src/lib/driveSync.ts)). At 10K that is a full-table
   read into a 512 MiB container **every hour**; at 100K it is a memory problem.
3. **The 300s single-request ceiling.** drive + refresh + summaries share one
   300s Cloud Run request. Just raising the caps to chase the SLA blows the budget
   long before it closes the gap: 10 web refreshes (fetch + `gemini-flash`
   distill + embed, ~3–8s each) + 5 Drive + up to 10 structured summaries already
   trend toward the ceiling.

### Adjacent scaling effects at 10K
- **Vector search crosses its own stated threshold.** Retrieval is an **exact
  scan** with no ANN index; the schema header itself names ~10k `ContextUrl` rows
  as the point to add HNSW ([`schema.prisma:11-18`](prisma/schema.prisma)). Each
  query is a `UNION ALL` of up to four full branch scans on `db-f1-micro` — search
  latency degrades here first. Note the header's caveat: the
  `embedding IS NOT NULL OR lex > 0` OR-filter ([`search.ts:168,183,213`](src/lib/search.ts))
  **defeats a pure index scan** — the lexical and semantic branches must be split
  before an HNSW index helps.
- **Summaries fall behind too.** More ingestions across more scopes → more
  staleness → but only **10 summaries/cycle** ([`summaries.ts:526`](src/lib/summaries.ts)).
- **~~No single-flight lock actually exists.~~ RESOLVED (#57).** The README (Flow 2)
  claimed a *"pg advisory lock (single-flight: overlapping ticks no-op)"* that did not
  exist. It does now: [`src/lib/singleFlight.ts`](src/lib/singleFlight.ts) wraps the
  cron handler, and an overlapping tick returns `{skipped: true}` without spending.
  This was **one of the two** prerequisites the ADR's decision 5 names; the other —
  decoupling the worker from the 300s request (recommendation 3 below) — is still
  open, so caps stay where they are.

### Recommendations (in dependency order)
1. **Declare the achievable SLA honestly.** With today's mechanics the realistic
   floor is *hours-to-days per lap at 10K*, not 1 hour. State a tiered freshness
   promise (e.g. trackers 6h, web daily) rather than an unmeetable 1h.
2. **Push selection into the DB.** Replace the load-everything `findMany` with
   `WHERE mode='watched' AND frozenAt IS NULL AND lastCheckedAt < now()-cadence
   ORDER BY lastCheckedAt LIMIT n`, backed by an index on
   `(mode, frozenAt, lastCheckedAt)`. O(n) work per tick instead of O(corpus).
3. **Decouple the worker from the 300s HTTP request.** Fan out due-source refresh
   onto **Cloud Tasks / a queue** with idempotent per-source handlers; the cron
   tick only *enqueues*. This is what lets throughput scale past ~15/hr without
   fighting the request ceiling, and it makes per-source concurrency explicit.
4. **Reintroduce priority scheduling — but with evidence.** `§6` deliberately
   removed per-row `nextCheckAt`; a 1h-over-10K SLA is exactly the "new evidence"
   that section asks for. Add a per-source `nextCheckAt` (schema change: expand →
   backfill → contract, per AGENTS.md/CHANGE_PLAYBOOK) and tier cadence by source
   importance instead of one global floor.
5. **Add the ANN index and split search branches** ([`schema.prisma:14-18`](prisma/schema.prisma)):
   `CREATE INDEX … USING hnsw (embedding vector_cosine_ops)`, and separate the
   lexical/semantic passes so the index is actually used.
6. ~~**Implement the single-flight advisory lock** the README already advertises,
   before raising any cap.~~ **DONE (#57)** — `src/lib/singleFlight.ts`.
7. **Right-size infra with the change, not before it:** `db-f1-micro` and 512 MiB
   Cloud Run are sized for hundreds of rows; 10K watched sources + HNSW + queue
   workers need a real DB tier and more memory. Track this as a cost decision.

---

## 6. Cross-cutting constraints to declare (not just fix)

These are the honest limits a user hitting any scenario above should see in-
product, independent of whether the deeper rework lands:

- **Granularity:** one digest + one embedding per source; content past **30K
  chars is dropped**. Large single documents are lossy; retrieval can't cite a
  specific passage.
- **Drive:** watches **native Google Docs only**, **one folder level deep**;
  everything else is silently skipped.
- **Chat:** captures a **single thread's first 100 messages**, **snapshot** —
  rooms and ongoing growth are not watched.
- **Binary/media:** **not indexable** at all.
- **Freshness:** bounded by fixed cadence (6h/168h) and small per-cycle caps —
  **sub-hour freshness over thousands of sources is not achievable** on the
  current architecture.
- **Search:** exact vector scan, **~10K-row** practical ceiling before an ANN
  index is required.

The through-line: AutoKnow's ingestion/freshness system is a well-reasoned design
**for a corpus of hundreds** (it says so, and the adversarial review that shaped
it deliberately deleted the machinery that scale would need). Every 10K scenario
fails at that seam. The fixes are known and mostly already sketched in the
codebase (delta feed via `SyncCursor`, HNSW via the schema comment, per-row
scheduling via `§6`'s "new evidence" clause) — they were consciously deferred, not
missed.
