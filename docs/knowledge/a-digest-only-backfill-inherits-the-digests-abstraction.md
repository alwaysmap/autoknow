---
title: A backfill that re-reads stored digests recovers only what the digest kept — and the summarizer abstracts names away
status: current
updated: 2026-08-14
applies_to:
  - npm run db:backfill:context-mentions
  - src/lib/mentionBackfill.ts
  - src/lib/gemini.ts extractDigestEntities
symptoms:
  - "backfill report: extracted N (0 mentions written) over rows whose ORIGINAL documents clearly named people"
  - a person-extraction pass over ContextUrl.ingestedText returns empty people for most old rows
verified_by: 'live run 2026-08-14 against autoknow_d285dae0_demo with a real key: three digests in a row nameless ("Denso cockpit integration and Honda Accord bring-up leads"), extracted 2 / written 0 — while ingest-time extraction over the same sources'' FULL text yielded 33 mentions'
---

# A digest-only backfill recovers only what the digest kept

**The lesson.** `ContextUrl.ingestedText` is the distilled digest, not the document,
and the distillation prompt optimizes for decision-useful summary — in practice it
abstracts people into roles ("bring-up leads", "the team"). So a backfill that
re-extracts entities from stored digests has structurally weak recall on old rows, and
`extracted N (0 mentions written)` is the expected honest outcome, not a defect to fix.

**Why it bites.** At ingest/refresh time, extraction sees the FULL fetched text and
names come back reliably; the backfill sees only what an earlier summarization chose to
keep. The gap is invisible until you compare the two paths on the same source. An agent
who only sees the backfill report will conclude the extraction call or the resolver is
broken and start "fixing" working code.

**What to do.** Trust the split the system already has: a WATCHED row heals on its next
real content change (ingest/refresh re-extracts from full text and rewrites its
mentions); a snapshot's digest is all it will ever have, and its empty result is
final. Do not widen the backfill to re-fetch originals — that is the freshness cron's
job, with its budget and its guards. If old-row recall ever matters enough to pay for,
the lever is the distillation prompt (make digests retain names), not the backfill.
