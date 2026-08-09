-- Initiatives (gh-286, part a). Purely ADDITIVE: one enum, two tables, one nullable
-- column on Project, their indexes and FKs — ships with app code in one PR per the
-- additive rule. Project.initiativeId is RESTRICT (not the nullable-FK house default
-- of SET NULL) so deleting an Initiative cannot silently promote its per-partner
-- copies into regular programs; see the schema comment on the relation.

-- CreateEnum
CREATE TYPE "InitiativeMemberStatus" AS ENUM ('active', 'removed');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "initiativeId" INTEGER;

-- CreateTable
CREATE TABLE "Initiative" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "targetDate" TIMESTAMP(3),
    "templateId" INTEGER NOT NULL,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Initiative_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InitiativePartner" (
    "id" SERIAL NOT NULL,
    "initiativeId" INTEGER NOT NULL,
    "partnerId" INTEGER NOT NULL,
    "status" "InitiativeMemberStatus" NOT NULL DEFAULT 'active',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "InitiativePartner_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Initiative_templateId_key" ON "Initiative"("templateId");

-- CreateIndex
CREATE INDEX "InitiativePartner_partnerId_idx" ON "InitiativePartner"("partnerId");

-- CreateIndex
CREATE UNIQUE INDEX "InitiativePartner_initiativeId_partnerId_key" ON "InitiativePartner"("initiativeId", "partnerId");

-- CreateIndex
CREATE INDEX "Project_initiativeId_idx" ON "Project"("initiativeId");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_initiativeId_fkey" FOREIGN KEY ("initiativeId") REFERENCES "Initiative"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Initiative" ADD CONSTRAINT "Initiative_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ProgramTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InitiativePartner" ADD CONSTRAINT "InitiativePartner_initiativeId_fkey" FOREIGN KEY ("initiativeId") REFERENCES "Initiative"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InitiativePartner" ADD CONSTRAINT "InitiativePartner_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
