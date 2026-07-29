-- CreateEnum
CREATE TYPE "EscalationStatus" AS ENUM ('open', 'resolved', 'duplicate', 'addressed', 'obsolete');

-- CreateEnum
CREATE TYPE "EscalationSeverity" AS ENUM ('s1', 's2', 's3');

-- CreateEnum
CREATE TYPE "EscalationOrgLevel" AS ENUM ('team', 'region', 'director', 'exec');

-- CreateTable
CREATE TABLE "Escalation" (
    "id" SERIAL NOT NULL,
    "originalRequest" TEXT,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "status" "EscalationStatus" NOT NULL DEFAULT 'open',
    "severity" "EscalationSeverity",
    "orgLevel" "EscalationOrgLevel",
    "closedAt" TIMESTAMP(3),
    "partnerId" INTEGER,
    "projectId" INTEGER,
    "ownerPersonId" INTEGER,
    "decisionMakerPersonId" INTEGER,
    "requestedOfPersonId" INTEGER,
    "raisedBy" TEXT,
    "sourceKind" TEXT NOT NULL DEFAULT 'chat',
    "contextUrlId" INTEGER,
    "duplicateOfId" INTEGER,
    "lastChatPostAt" TIMESTAMP(3),
    "lastChatPostError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Escalation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Escalation_partnerId_idx" ON "Escalation"("partnerId");

-- CreateIndex
CREATE INDEX "Escalation_projectId_idx" ON "Escalation"("projectId");

-- CreateIndex
CREATE INDEX "Escalation_ownerPersonId_idx" ON "Escalation"("ownerPersonId");

-- CreateIndex
CREATE INDEX "Escalation_decisionMakerPersonId_idx" ON "Escalation"("decisionMakerPersonId");

-- CreateIndex
CREATE INDEX "Escalation_requestedOfPersonId_idx" ON "Escalation"("requestedOfPersonId");

-- CreateIndex
CREATE INDEX "Escalation_contextUrlId_idx" ON "Escalation"("contextUrlId");

-- CreateIndex
CREATE INDEX "Escalation_duplicateOfId_idx" ON "Escalation"("duplicateOfId");

-- CreateIndex
CREATE INDEX "Escalation_status_idx" ON "Escalation"("status");

-- CreateIndex
CREATE INDEX "Escalation_severity_idx" ON "Escalation"("severity");

-- AddForeignKey
ALTER TABLE "Escalation" ADD CONSTRAINT "Escalation_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Escalation" ADD CONSTRAINT "Escalation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Escalation" ADD CONSTRAINT "Escalation_ownerPersonId_fkey" FOREIGN KEY ("ownerPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Escalation" ADD CONSTRAINT "Escalation_decisionMakerPersonId_fkey" FOREIGN KEY ("decisionMakerPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Escalation" ADD CONSTRAINT "Escalation_requestedOfPersonId_fkey" FOREIGN KEY ("requestedOfPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Escalation" ADD CONSTRAINT "Escalation_contextUrlId_fkey" FOREIGN KEY ("contextUrlId") REFERENCES "ContextUrl"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Escalation" ADD CONSTRAINT "Escalation_duplicateOfId_fkey" FOREIGN KEY ("duplicateOfId") REFERENCES "Escalation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
