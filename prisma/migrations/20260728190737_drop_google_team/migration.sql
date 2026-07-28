-- allow-destructive: #127 E13 contract step, decided 2026-07-28 (bead autoknow-777).
-- Partner.googleTeam was a dateless email-keyed JSON people-store with no user-facing
-- mutation surface; PR #242 (deployed first — remove = app PR first) deleted its only
-- reader and its only (seed-time) writer, so at this point nothing reads or writes the
-- column. The blobs it held are old-seed artifacts, and the relationship-role fact
-- inside them was deliberately dropped rather than migrated — the recorded decision,
-- not an accident.

-- AlterTable
ALTER TABLE "Partner" DROP COLUMN "googleTeam";
