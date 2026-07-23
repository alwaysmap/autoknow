---
status: accepted
date: 2026-07-23
supersedes: ""
superseded-by: ""
tags: [ingestion, infra, cost, observability, scaling]
---

# Ingestion health is a serverless signal, not a growing table

**Context.** The hourly refresh worker (Cloud Scheduler → Cloud Run
`/api/cron/refresh` → `lib/driveSync` + `lib/refresh`) already computes everything
#38 asks to surface: `DriveSyncReport.skippedOtherTypes` (non-Doc files shared with
the service account, discovered and dropped), and `CycleReport.due` against the
`MAX_REFRESHES_PER_CYCLE = 10` cap (hourly ⇒ a 240 re-digest/day ceiling; overflow
carries to the next cycle, oldest first). But those reports are returned **only in
the cron's HTTP response** — invisible unless someone reads Cloud Run logs. So a
Sheet or a nested folder shared with the app looks ingested and is not (the "faked
result" AGENTS lesson 5 rules out), and nobody can answer "is ingestion keeping up?"
without the console.

The constraint on the fix (user, 2026-07-23): **scalable and cheap — cost to zero
when not in use.** The infra today makes that concrete. Cloud Run scales to zero.
Cloud SQL Postgres is a *provisioned, always-on* instance — the pre-existing cost
floor, not #38's doing. There is **no monitoring or alerting** at all yet. The
naive reading of #38 — "persist `DriveSyncReport`/`CycleReport`" as rows — would add
an **append-only table that grows with time** (hourly ⇒ ~8,800 rows/yr, plus a
record per skipped file), turning a fixed-cost DB into a creeping one and eventually
a query-scale problem. That is precisely the corpus-size assumption §6 tells us to
*watch*, reintroduced as our own liability.

**Decision.** #38's surfacing is built from pieces that each cost ~zero when idle,
and it adds **no new always-on cost**:

1. **Cloud Logging is the canonical telemetry store.** The cron emits its reports as
   structured logs (they already flow to Cloud Logging from Cloud Run). Logging
   auto-scales, is retention-bounded, and costs ~nothing at this volume. There is
   **no database history table**.
2. **The drain alarm is a Cloud Monitoring alert on a log-based metric** — backlog
   (`due − MAX_REFRESHES_PER_CYCLE`, or a carried-count field) sustained above zero
   for N consecutive cycles. Serverless, ~zero idle cost. This is §6's *"revisit the
   simple design"* trigger, delivered as **evidence, not intuition** — the whole
   point of the issue.
3. **The in-app health view reads bounded state, never history.** The cron **upserts
   a single latest-cycle summary** (the newest `CycleReport` + skip counts) that the
   health card reads; and the "shared but not ingested" list is a **query over the
   currently-shared set** (a bounded per-source skip reason, pruned when a file stops
   being shared). Both scale with the **corpus**, never with **time** — O(1) and
   O(shared-files), not O(cycles).

Per-file honesty closes lesson 5: every discovered-but-dropped file (wrong type, or
beyond the folder depth the product actually claims) records its skip reason and
shows in Manage → Sources as *"shared but not ingested — <reason>"*, so sharing
never silently looks like it worked. **Expanding what is ingested** (export/extract
paths for Sheets/Slides/PDF, deeper folder recursion) is a **separate, gated
decision** — the scaling ADR's territory, arguably the 10K program — **not this
ADR**. #38 makes the limits honest and visible; it does not lift them.

**Alternatives rejected.**
- *An append-only `DriveSyncReport`/`CycleReport` table in Postgres.* The obvious
  reading of "persist the reports," and the wrong one: it grows without bound, makes
  the always-on DB the thing that scales badly, and needs a pruning cron nobody will
  tune. The point of #38 is to notice unbounded growth, not to add some.
- *Cloud Monitoring dashboards as the only surface.* Free and scalable, but the issue
  requires visibility **for the person who shared a file** — a GCP console is not
  where they look.
- *Read the full history from Cloud Logging on every health-page view.* The purest
  cost-to-zero, but it adds `logging.viewer` to the runtime role, per-view query
  latency and cost, and complexity for the common case. A single upserted summary row
  is effectively free and simpler; the full history stays in logs for deep dives.
- *Adaptive / AIMD scheduling to "fix" the backlog.* Forbidden by §6 without new
  evidence — and producing that evidence (the alarm) is exactly what this builds.
- *A second always-on service (worker/queue consumer) to persist telemetry.* A new
  fixed cost for work the hourly cron already does; it violates cost-to-zero outright.

**Consequences.** #38 is cost-to-zero-when-idle by construction: logs and the
log-based metric/alert are ~free when nothing is happening, the health page rides
Cloud Run to zero, and the only DB additions are O(1) and O(corpus), never O(time).
The backlog alarm becomes the §6 trigger, so "the simple design stopped fitting" is
an alert rather than a surprise. The rollout follows the AGENTS infra-ordering rule:
the **log-based metric + alert policy + notification channel land in an infra PR with
a human `terraform apply` FIRST**; the **app PR second** (structured logging, the
upserted summary + skip rows, the health UI, the "not ingested" list), config-gated
so it degrades honestly if the metric/alert are not present yet. The additive
`latest-cycle summary` + `skipped-source` rows ship with the app PR (additive schema,
one merge). `INGEST_FRESHNESS_PLAN.md` gains a health-surfacing/alarm section with its
STATUS and section numbers updated in the same PR (lesson 10; code cites `plan §x.y`).
The pre-existing Cloud SQL always-on floor is **out of scope** — moving to a
serverless Postgres is an app-wide decision, not this one.
