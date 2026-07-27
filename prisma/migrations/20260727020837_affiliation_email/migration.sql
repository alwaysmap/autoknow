-- AlterTable
ALTER TABLE "PersonAffiliation" ADD COLUMN     "email" TEXT;

-- CreateIndex
CREATE INDEX "PersonAffiliation_email_idx" ON "PersonAffiliation"("email");
