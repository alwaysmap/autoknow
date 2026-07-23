-- CreateTable
CREATE TABLE "IngestionCycleSummary" (
    "key" TEXT NOT NULL DEFAULT 'latest',
    "ranAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "driveConfigured" BOOLEAN NOT NULL DEFAULT false,
    "sharedSeen" INTEGER NOT NULL DEFAULT 0,
    "discovered" INTEGER NOT NULL DEFAULT 0,
    "refreshed" INTEGER NOT NULL DEFAULT 0,
    "skippedOtherTypes" INTEGER NOT NULL DEFAULT 0,
    "skippedTooDeep" INTEGER NOT NULL DEFAULT 0,
    "driveErrors" INTEGER NOT NULL DEFAULT 0,
    "due" INTEGER NOT NULL DEFAULT 0,
    "checked" INTEGER NOT NULL DEFAULT 0,
    "changed" INTEGER NOT NULL DEFAULT 0,
    "frozen" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "skippedDrive" INTEGER NOT NULL DEFAULT 0,
    "backlog" INTEGER NOT NULL DEFAULT 0,
    "quotaStopped" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "IngestionCycleSummary_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "SkippedSource" (
    "fileId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "sharedBy" TEXT,
    "folderDepth" INTEGER,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SkippedSource_pkey" PRIMARY KEY ("fileId")
);

-- CreateTable
CREATE TABLE "IngestionSettings" (
    "key" TEXT NOT NULL DEFAULT 'default',
    "dailyReingestBudgetDocs" INTEGER NOT NULL DEFAULT 60,
    "freeTierRequestsPerDay" INTEGER NOT NULL DEFAULT 250,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IngestionSettings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "SkippedSource_reason_idx" ON "SkippedSource"("reason");
