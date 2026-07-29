-- Six indexes for reads that currently have none. Purely additive: no column changes, no
-- data movement, and every statement is a CREATE INDEX, so the old revision keeps serving
-- unchanged through the rollout window.
--
-- Three kinds of gap, all found by auditing query shapes rather than by watching latency —
-- at today's volumes (largest table ~250 rows) Postgres correctly seq-scans all of these
-- and will keep doing so until the tables grow. This is about the shape being right before
-- the data arrives, not about a slow page today.
--
-- 1. FKs Postgres never auto-indexes. Project.partnerId and Person.currentPartnerId are
--    read by the partner page and the delete-blocker counts, AND scanned by Postgres to
--    enforce their RESTRICT on every partner delete. Project.ownerPersonId already had
--    this treatment with the reasoning written next to it; these two were missed.
--    Project's is the composite (partnerId, name) because lib/partnerPrograms wants the
--    filter and the sort together; partnerId alone is its prefix, so the blocker count is
--    served too, as are lib/search's partner-scoped program query (search.ts:268) and its
--    one partnerId-keyed subselect (search.ts:321). Note search.ts:251 looks similar and
--    is NOT served: it selects partnerId keyed on Project.id, which the PK already covers.
--
-- 2. Person.email, whose index the E9 `unique_at_an_instant` migration dropped along with
--    the false `@unique` claim — correctly — without noticing that the plain `=` reader
--    survived it (the duplicate check on every person creation).
--
-- 3. Bare `timestamp` on the three State tables. Each already has a (scopeId, timestamp)
--    composite, which cannot serve a query with no scope predicate: the leading column is
--    unconstrained, so the whole table is sorted. For ProjectState and PhaseState the
--    caller that matters is lib/summaries' ecosystem staleness probe, where the HEALTHY
--    case is the expensive one — `findFirst({ where: { timestamp: { gt: after } } })`
--    matches nothing when the brief is fresh, so it scans everything to return null.
--    PartnerState is the same shape with a different caller: that probe never reads it
--    unscoped; app/partners does, loading every relationship state to reduce in JS.
--    ContextUrl already had a bare `createdAt` index for exactly this; the State tables
--    are the asymmetry.
--
-- These are the SUFFIX of their composites, not the prefix, so they are NOT the redundancy
-- that `20260727..._drop_redundant_affiliation_indexes` cleaned up. Do not "align" them.
--
-- Plain CREATE INDEX rather than CONCURRENTLY: these tables hold hundreds of rows, the
-- build is milliseconds, and migrate deploy runs before the new revision serves. The
-- CONCURRENTLY recipe (non-transactional migration, and an INVALID index left behind if it
-- fails) is the right trade only once a table is big enough for the write lock to be felt.

-- CreateIndex
CREATE INDEX "PartnerState_timestamp_idx" ON "PartnerState"("timestamp");

-- CreateIndex
CREATE INDEX "Person_email_idx" ON "Person"("email");

-- CreateIndex
CREATE INDEX "Person_currentPartnerId_idx" ON "Person"("currentPartnerId");

-- CreateIndex
CREATE INDEX "PhaseState_timestamp_idx" ON "PhaseState"("timestamp");

-- CreateIndex
CREATE INDEX "Project_partnerId_name_idx" ON "Project"("partnerId", "name");

-- CreateIndex
CREATE INDEX "ProjectState_timestamp_idx" ON "ProjectState"("timestamp");
