-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "ProjectLifecycle" AS ENUM ('active', 'complete', 'cancelled');

-- CreateTable
CREATE TABLE "Partner" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "typeId" INTEGER,
    "embedding" vector(768),
    "website" TEXT,
    "internalDetailsUrl" TEXT,
    "summary" TEXT,
    "googleTeam" JSONB,
    "phone" TEXT,
    "regionId" INTEGER NOT NULL,

    CONSTRAINT "Partner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Region" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Region_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerType" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "PartnerType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "partnerId" INTEGER NOT NULL,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "theNeedle" TEXT NOT NULL DEFAULT 'Low',
    "hillChartProgress" INTEGER NOT NULL DEFAULT 0,
    "sopDate" TIMESTAMP(3),
    "ownerName" TEXT,
    "volumeFirstYear" INTEGER NOT NULL DEFAULT 0,
    "hasGas" BOOLEAN NOT NULL DEFAULT false,
    "hasGbi" BOOLEAN NOT NULL DEFAULT false,
    "hasDigitalKey" BOOLEAN NOT NULL DEFAULT false,
    "hasAap" BOOLEAN NOT NULL DEFAULT false,
    "lifecycle" "ProjectLifecycle" NOT NULL DEFAULT 'active',
    "embedding" vector(768),

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Summary" (
    "id" SERIAL NOT NULL,
    "scope" TEXT NOT NULL,
    "targetId" INTEGER NOT NULL DEFAULT 0,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trigger" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "tldr" TEXT NOT NULL,
    "body" JSONB NOT NULL,
    "sourceCounts" JSONB NOT NULL,

    CONSTRAINT "Summary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SummaryPrompt" (
    "scope" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SummaryPrompt_pkey" PRIMARY KEY ("scope")
);

-- CreateTable
CREATE TABLE "Phase" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "forecastedDuration" INTEGER NOT NULL DEFAULT 30,
    "description" TEXT,
    "googleFocus" TEXT,
    "leadPartnerId" INTEGER,
    "isEndPhase" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Phase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhasePartner" (
    "id" SERIAL NOT NULL,
    "phaseId" INTEGER NOT NULL,
    "partnerId" INTEGER NOT NULL,
    "role" TEXT,

    CONSTRAINT "PhasePartner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhasePerson" (
    "id" SERIAL NOT NULL,
    "phaseId" INTEGER NOT NULL,
    "personId" INTEGER NOT NULL,
    "role" TEXT,

    CONSTRAINT "PhasePerson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhaseDependency" (
    "id" SERIAL NOT NULL,
    "phaseId" INTEGER NOT NULL,
    "dependsOnPhaseId" INTEGER NOT NULL,

    CONSTRAINT "PhaseDependency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhaseState" (
    "id" SERIAL NOT NULL,
    "phaseId" INTEGER NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL,
    "hillChartProgress" INTEGER,
    "theNeedle" TEXT,
    "isStagnant" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "source" TEXT,
    "sourceUrl" TEXT,

    CONSTRAINT "PhaseState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionItem" (
    "id" SERIAL NOT NULL,
    "phaseId" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "assignedTo" TEXT,
    "assignedToPersonId" INTEGER,
    "status" TEXT NOT NULL,
    "nextStep" TEXT NOT NULL DEFAULT 'Undecided',
    "linkUrl" TEXT,
    "source" TEXT,
    "sourceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContextUrl" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER,
    "partnerId" INTEGER,
    "phaseId" INTEGER,
    "url" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT,
    "ingestedText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "embedding" vector(768),
    "mode" TEXT NOT NULL DEFAULT 'snapshot',
    "modeSource" TEXT NOT NULL DEFAULT 'inferred',
    "sourceRef" TEXT,
    "sourceVersion" TEXT,
    "contentHash" TEXT,
    "sourceStatus" TEXT,
    "addedBy" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "lastChangedAt" TIMESTAMP(3),
    "frozenAt" TIMESTAMP(3),
    "frozenReason" TEXT,

    CONSTRAINT "ContextUrl_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContextRevision" (
    "id" SERIAL NOT NULL,
    "contextUrlId" INTEGER NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceVersion" TEXT,
    "contentHash" TEXT NOT NULL,
    "sourceStatus" TEXT,
    "digest" TEXT NOT NULL,
    "delta" TEXT,

    CONSTRAINT "ContextRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncCursor" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncCursor_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Person" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "currentPartnerId" INTEGER NOT NULL,
    "notes" TEXT,
    "embedding" vector(768),

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgramTemplate" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isBuiltIn" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProgramTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhaseTemplate" (
    "id" SERIAL NOT NULL,
    "templateId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "googleFocus" TEXT,
    "leadRole" TEXT,
    "durationWeeks" INTEGER NOT NULL DEFAULT 4,
    "isEndPhase" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PhaseTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhaseTemplateDep" (
    "id" SERIAL NOT NULL,
    "phaseTemplateId" INTEGER NOT NULL,
    "dependsOnId" INTEGER NOT NULL,

    CONSTRAINT "PhaseTemplateDep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonAffiliation" (
    "id" SERIAL NOT NULL,
    "personId" INTEGER NOT NULL,
    "partnerId" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),

    CONSTRAINT "PersonAffiliation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectState" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "theNeedle" TEXT NOT NULL,
    "hillChartProgress" INTEGER NOT NULL,
    "notes" TEXT,
    "source" TEXT,
    "sourceUrl" TEXT,

    CONSTRAINT "ProjectState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerState" (
    "id" SERIAL NOT NULL,
    "partnerId" INTEGER NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "theNeedle" TEXT NOT NULL DEFAULT 'Low',
    "hillChartProgress" INTEGER NOT NULL DEFAULT 0,
    "relationshipScore" INTEGER,
    "notes" TEXT NOT NULL,
    "source" TEXT,
    "sourceUrl" TEXT,

    CONSTRAINT "PartnerState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Region_name_key" ON "Region"("name");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerType_name_key" ON "PartnerType"("name");

-- CreateIndex
CREATE INDEX "Summary_scope_targetId_generatedAt_idx" ON "Summary"("scope", "targetId", "generatedAt");

-- CreateIndex
CREATE INDEX "Phase_projectId_idx" ON "Phase"("projectId");

-- CreateIndex
CREATE INDEX "PhasePartner_partnerId_idx" ON "PhasePartner"("partnerId");

-- CreateIndex
CREATE UNIQUE INDEX "PhasePartner_phaseId_partnerId_key" ON "PhasePartner"("phaseId", "partnerId");

-- CreateIndex
CREATE INDEX "PhasePerson_personId_idx" ON "PhasePerson"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "PhasePerson_phaseId_personId_key" ON "PhasePerson"("phaseId", "personId");

-- CreateIndex
CREATE INDEX "PhaseDependency_dependsOnPhaseId_idx" ON "PhaseDependency"("dependsOnPhaseId");

-- CreateIndex
CREATE UNIQUE INDEX "PhaseDependency_phaseId_dependsOnPhaseId_key" ON "PhaseDependency"("phaseId", "dependsOnPhaseId");

-- CreateIndex
CREATE INDEX "PhaseState_phaseId_timestamp_idx" ON "PhaseState"("phaseId", "timestamp");

-- CreateIndex
CREATE INDEX "ActionItem_phaseId_idx" ON "ActionItem"("phaseId");

-- CreateIndex
CREATE INDEX "ActionItem_assignedToPersonId_idx" ON "ActionItem"("assignedToPersonId");

-- CreateIndex
CREATE UNIQUE INDEX "ContextUrl_sourceRef_key" ON "ContextUrl"("sourceRef");

-- CreateIndex
CREATE INDEX "ContextUrl_mode_frozenAt_idx" ON "ContextUrl"("mode", "frozenAt");

-- CreateIndex
CREATE INDEX "ContextUrl_projectId_idx" ON "ContextUrl"("projectId");

-- CreateIndex
CREATE INDEX "ContextUrl_partnerId_idx" ON "ContextUrl"("partnerId");

-- CreateIndex
CREATE INDEX "ContextUrl_phaseId_idx" ON "ContextUrl"("phaseId");

-- CreateIndex
CREATE INDEX "ContextUrl_createdAt_idx" ON "ContextUrl"("createdAt");

-- CreateIndex
CREATE INDEX "ContextRevision_contextUrlId_checkedAt_idx" ON "ContextRevision"("contextUrlId", "checkedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Person_email_key" ON "Person"("email");

-- CreateIndex
CREATE UNIQUE INDEX "ProgramTemplate_name_isBuiltIn_key" ON "ProgramTemplate"("name", "isBuiltIn");

-- CreateIndex
CREATE UNIQUE INDEX "PhaseTemplateDep_phaseTemplateId_dependsOnId_key" ON "PhaseTemplateDep"("phaseTemplateId", "dependsOnId");

-- CreateIndex
CREATE INDEX "PersonAffiliation_personId_idx" ON "PersonAffiliation"("personId");

-- CreateIndex
CREATE INDEX "PersonAffiliation_partnerId_idx" ON "PersonAffiliation"("partnerId");

-- CreateIndex
CREATE INDEX "ProjectState_projectId_timestamp_idx" ON "ProjectState"("projectId", "timestamp");

-- CreateIndex
CREATE INDEX "PartnerState_partnerId_timestamp_idx" ON "PartnerState"("partnerId", "timestamp");

-- AddForeignKey
ALTER TABLE "Partner" ADD CONSTRAINT "Partner_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "PartnerType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Partner" ADD CONSTRAINT "Partner_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Phase" ADD CONSTRAINT "Phase_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Phase" ADD CONSTRAINT "Phase_leadPartnerId_fkey" FOREIGN KEY ("leadPartnerId") REFERENCES "Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhasePartner" ADD CONSTRAINT "PhasePartner_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "Phase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhasePartner" ADD CONSTRAINT "PhasePartner_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhasePerson" ADD CONSTRAINT "PhasePerson_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "Phase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhasePerson" ADD CONSTRAINT "PhasePerson_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhaseDependency" ADD CONSTRAINT "PhaseDependency_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "Phase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhaseDependency" ADD CONSTRAINT "PhaseDependency_dependsOnPhaseId_fkey" FOREIGN KEY ("dependsOnPhaseId") REFERENCES "Phase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhaseState" ADD CONSTRAINT "PhaseState_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "Phase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionItem" ADD CONSTRAINT "ActionItem_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "Phase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionItem" ADD CONSTRAINT "ActionItem_assignedToPersonId_fkey" FOREIGN KEY ("assignedToPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContextUrl" ADD CONSTRAINT "ContextUrl_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContextUrl" ADD CONSTRAINT "ContextUrl_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContextUrl" ADD CONSTRAINT "ContextUrl_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "Phase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContextRevision" ADD CONSTRAINT "ContextRevision_contextUrlId_fkey" FOREIGN KEY ("contextUrlId") REFERENCES "ContextUrl"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Person" ADD CONSTRAINT "Person_currentPartnerId_fkey" FOREIGN KEY ("currentPartnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhaseTemplate" ADD CONSTRAINT "PhaseTemplate_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ProgramTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhaseTemplateDep" ADD CONSTRAINT "PhaseTemplateDep_phaseTemplateId_fkey" FOREIGN KEY ("phaseTemplateId") REFERENCES "PhaseTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhaseTemplateDep" ADD CONSTRAINT "PhaseTemplateDep_dependsOnId_fkey" FOREIGN KEY ("dependsOnId") REFERENCES "PhaseTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonAffiliation" ADD CONSTRAINT "PersonAffiliation_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonAffiliation" ADD CONSTRAINT "PersonAffiliation_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectState" ADD CONSTRAINT "ProjectState_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerState" ADD CONSTRAINT "PartnerState_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

