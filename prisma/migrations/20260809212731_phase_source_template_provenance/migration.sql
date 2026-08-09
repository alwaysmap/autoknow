-- Initiatives (gh-286, bead hcz.13). Purely ADDITIVE: one nullable provenance column,
-- its index and a SET NULL FK — plus a scoped UPDATE that fills the column for the
-- initiative copies that already exist, matching each copy phase to its initiative's
-- snapshot step BY NAME (the one-time bootstrap; from here on the creator writes the
-- id and renames propagate by id, never by name). The UPDATE touches only phases of
-- initiative copies whose name matches a step of that initiative's own template —
-- a handful of rows today — and the IS NULL guard means a re-run never overwrites a stamped id.

-- AlterTable
ALTER TABLE "Phase" ADD COLUMN     "sourcePhaseTemplateId" INTEGER;

-- CreateIndex
CREATE INDEX "Phase_sourcePhaseTemplateId_idx" ON "Phase"("sourcePhaseTemplateId");

-- AddForeignKey
ALTER TABLE "Phase" ADD CONSTRAINT "Phase_sourcePhaseTemplateId_fkey" FOREIGN KEY ("sourcePhaseTemplateId") REFERENCES "PhaseTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Bootstrap provenance for existing initiative copies (name match against the copy's
-- own initiative snapshot only).
-- allow-destructive: one-time bootstrap UPDATE of a column created two statements up;
-- scoped to initiative copies, IS NULL-guarded so it never overwrites a stamped id,
-- and rows without a name match are exactly what lib/initiativeSync's name fallback
-- handles at the next template edit.
UPDATE "Phase" p
SET "sourcePhaseTemplateId" = pt.id
FROM "Project" proj, "Initiative" i, "PhaseTemplate" pt
WHERE p."projectId" = proj.id
  AND proj."initiativeId" = i.id
  AND pt."templateId" = i."templateId"
  AND pt.name = p.name
  AND p."sourcePhaseTemplateId" IS NULL;
