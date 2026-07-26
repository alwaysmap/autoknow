-- #127 E6 — the owner of a program becomes an entity reference (#124 §1 Class 4, §5).
-- Purely ADDITIVE: a nullable column, its index, and a SET NULL foreign key, exactly
-- the shape ActionItem.assignedToPersonId has carried since 0_init. `ownerName` is
-- untouched and stays the read path, so the previous revision keeps serving happily
-- through the rollout window.
--
-- NO data is written here. The backfill is a separate, idempotent, re-runnable script
-- (`npm run db:backfill:owner-person`) because it has to resolve a NAME to a PERSON,
-- and that decision needs a report and a human looking at it — not a silent one-shot
-- inside `migrate deploy` (docs/CHANGE_PLAYBOOK.md).
--
-- Plain CREATE INDEX, not CONCURRENTLY: Project holds hundreds of rows here, and a
-- non-transactional migration buys nothing at that size.

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "ownerPersonId" INTEGER;

-- CreateIndex
CREATE INDEX "Project_ownerPersonId_idx" ON "Project"("ownerPersonId");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_ownerPersonId_fkey" FOREIGN KEY ("ownerPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;
