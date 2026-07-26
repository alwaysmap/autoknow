-- #127 E4 (spec #124 §5, migration rows 2 and 5): as-of indexes for the temporal
-- resolvers that land in E5. Every as-of lookup picks a person (or a partner) and
-- THEN filters the half-open interval `startDate <= t < endDate`; today only
-- ("personId") and ("partnerId") exist, so the range half is a scan of every row
-- that person/partner has ever had. Feeds resolve many people × many timestamps,
-- so that scan multiplies. This ships BEFORE the resolver precisely so the
-- resolver is never deployed onto an unindexed range scan.
--
-- Purely additive: two CREATE INDEX statements, no data touched, no column or
-- index dropped. The existing ("personId") and ("partnerId") indexes are strict
-- prefixes of the new ones and are now redundant for reads, but dropping them is
-- a separate non-additive change and is deliberately NOT in this migration.
--
-- Plain CREATE INDEX, not CONCURRENTLY: PersonAffiliation is a small table (one
-- row per employment period per tracked person) and `migrate deploy` runs before
-- the new revision serves, so the brief write lock is not a live-traffic hazard.

-- CreateIndex
CREATE INDEX "PersonAffiliation_personId_startDate_endDate_idx" ON "PersonAffiliation"("personId", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "PersonAffiliation_partnerId_startDate_endDate_idx" ON "PersonAffiliation"("partnerId", "startDate", "endDate");
