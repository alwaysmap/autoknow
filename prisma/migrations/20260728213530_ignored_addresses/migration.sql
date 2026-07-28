-- CreateTable
CREATE TABLE "IgnoredAddress" (
    "id" SERIAL NOT NULL,
    "address" TEXT NOT NULL,
    "dismissedBy" TEXT NOT NULL,
    "dismissedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IgnoredAddress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IgnoredAddress_address_key" ON "IgnoredAddress"("address");
