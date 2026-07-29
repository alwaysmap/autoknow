---
status: accepted
date: 2026-07-29
supersedes: ""
superseded-by: ""
extends: ""
extended-by: ""
tags: [database, performance]
---

# An index is justified by query SHAPE, and proved at synthetic scale — never by profiling this data

**Context.** A schema audit found `Project.partnerId` and `Person.currentPartnerId`
unindexed (Postgres does not auto-index FK columns), and `Person.email` holding a reader
whose index migration `20260727040058_unique_at_an_instant` had dropped along with a false
`@unique`. All three are read on live paths. None of them was slow, and none could be:
the largest table in this system is ~250 rows, where Postgres correctly seq-scans
everything and `pg_stat_user_tables` seq-scan ratios say nothing at all. The usual
discipline — "don't add an index you haven't proved you need" — cannot be satisfied here,
and taken literally it means never indexing anything until the day the data arrives and
the pages are already slow.

**Decision.** An index in this repo is justified by the **shape** of the queries that read
the column — the `where`, the `orderBy`, the FK a `RESTRICT` must scan — and by that shape
being one an index can serve. Where the claim is worth proving, prove it on a **scratch
database loaded to synthetic scale**, not on this one:

```
CREATE DATABASE x;  DATABASE_URL=… npm run db:migrate:deploy   # then generate_series rows
EXPLAIN ANALYZE …   # with the index, then DROP INDEX and again
```

State the shape and its caller in the schema beside the `@@index`, and the measurement in
the migration header, which is immutable once merged.

Two corollaries this session used:

- **A low-selectivity boolean gets no index.** `Project.isArchived` is read on ~8 paths and
  was deliberately left alone: most rows match, so Postgres seq-scans past it anyway.
- **A suffix is not a prefix.** `20260728202122_drop_redundant_affiliation_indexes` removed
  single-column indexes that were strict PREFIXES of a composite. A bare `timestamp`
  alongside `(scopeId, timestamp)` is the composite's SUFFIX, which no prefix rule reaches
  — it is the only thing that can serve a read with no scope predicate. The distinction is
  written next to both, because "align these" is the plausible wrong next edit.

**Alternatives rejected.**

- *Wait until it is slow.* The reads that degrade first are the ones nobody watches. The
  clearest case here is `lib/summaries`' staleness probe, where **the healthy case is the
  expensive one** — when the brief is fresh nothing matches, so it scans the whole table to
  return null, on the append-only table that grows fastest. That is invisible until it is
  not.
- *Profile against current data.* At 250 rows every plan is a seq scan and every
  measurement says "fine". Profiling here yields false confidence, not evidence.
- *Index every column a query mentions.* Rejected by the two corollaries above; write
  amplification is real and this repo has already paid to remove indexes that earned
  nothing.

**Consequences.** Index PRs carry prose about callers rather than before/after latency,
and reviewers check the cited call sites rather than a benchmark — four review rounds on
PR #259 were spent on exactly that, and caught three comment claims that did not survive
being checked against source. Synthetic proof is a scratch database, never the shared dev
DB, and never `*_test` (`db-change`).

This does NOT license adding an ANN index to the vector columns: that one is blocked on
query structure rather than scale, and stays gated by
[the 10k rebuild ADR](2026-07-22-ingestion-sized-for-hundreds-gate-the-10k-rebuild.md).

**Receipts.** PR #259 (`0b97448`), migration
`20260729015546_add_missing_fk_and_unscoped_timestamp_indexes`; the staleness probe at 200k
synthetic rows — Index Scan 0.046 ms vs Seq Scan 36.5 ms.
