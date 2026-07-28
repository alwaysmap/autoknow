-- #127 E4 follow-up (bead autoknow-4y3). E4 created
-- "PersonAffiliation_personId_startDate_endDate_idx" and
-- "PersonAffiliation_partnerId_startDate_endDate_idx" and said, in that migration's own
-- header, that the two pre-existing single-column indexes were now redundant and that
-- dropping them was a separate non-additive change. This is that change.
--
-- allow-destructive: drops two indexes, no data. ("personId") is a strict PREFIX of
-- ("personId", "startDate", "endDate"), and ("partnerId") of ("partnerId", "startDate",
-- "endDate"), so a btree on the composite answers every equality lookup the single
-- answered — same leading column, same Index Cond — and the singles were costing write
-- amplification on every insert and every move, plus their own pages, for no read a
-- composite does not already serve. This removes a redundant write cost, not an access
-- path. No CREATE is needed first (contrast
-- 20260725163111_due_source_selection_index, which had to create the wider index before
-- dropping the narrow one): the replacements have been in place since E4 shipped, so
-- there is no instant here where the pair is unindexed.
--
-- Held back until E5's temporal resolvers had been observed healthy in prod, so that a
-- plan regression is attributable to one change rather than to the pair.
--
-- The GiST index behind "PersonAffiliation_email_unique_at_an_instant" (#127 E9) is NOT
-- part of this argument: "personId" is not its leading column, so it substitutes for
-- neither of these and neither of these was propping it up.
--
-- Deliberately NOT dropped: "PersonAffiliation_email_idx" (#127 E8) is a prefix of
-- nothing and is the only index serving "who has ever held this address".

-- DropIndex
DROP INDEX "PersonAffiliation_personId_idx";

-- DropIndex
DROP INDEX "PersonAffiliation_partnerId_idx";
