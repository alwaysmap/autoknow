-- Additive (#56): flags a row whose text ran past MAX_DOC_CHARS (30K), so the loss is
-- visible on Manage → Sources instead of being a silent limit (ADR
-- ingestion-sized-for-hundreds decision 3, AGENTS lesson 5). Existing rows default to
-- false and are re-evaluated on their next refresh; nothing is backfilled.

-- AlterTable
ALTER TABLE "ContextUrl" ADD COLUMN     "truncated" BOOLEAN NOT NULL DEFAULT false;
