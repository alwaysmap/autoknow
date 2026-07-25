-- #58: the cron's due-source query filters on (mode, frozenAt), orders by lastCheckedAt
-- and LIMITs the budget. Widening the pair with lastCheckedAt lets Postgres serve the
-- whole statement from the index instead of sorting every watched row to take ten.
--
-- CREATE runs BEFORE DROP, deliberately: the generated order was the reverse, which
-- leaves a window with no index on the pair at all. Dropping is safe because
-- (mode, frozenAt) is a strict PREFIX of the index created below, so every query the old
-- index served is still served — this removes a redundant write cost, not an access path.
-- No data is touched, so this is not a destructive migration.

-- CreateIndex
CREATE INDEX "ContextUrl_mode_frozenAt_lastCheckedAt_idx" ON "ContextUrl"("mode", "frozenAt", "lastCheckedAt");

-- DropIndex
DROP INDEX "ContextUrl_mode_frozenAt_idx";
