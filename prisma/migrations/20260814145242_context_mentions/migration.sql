-- AlterTable
ALTER TABLE "ContextUrl" ADD COLUMN     "mentionsExtractedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ContextMention" (
    "id" SERIAL NOT NULL,
    "contextUrlId" INTEGER NOT NULL,
    "rawName" TEXT NOT NULL,
    "personId" INTEGER,
    "basis" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContextMention_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContextMention_personId_idx" ON "ContextMention"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "ContextMention_contextUrlId_rawName_key" ON "ContextMention"("contextUrlId", "rawName");

-- AddForeignKey
ALTER TABLE "ContextMention" ADD CONSTRAINT "ContextMention_contextUrlId_fkey" FOREIGN KEY ("contextUrlId") REFERENCES "ContextUrl"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContextMention" ADD CONSTRAINT "ContextMention_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;
