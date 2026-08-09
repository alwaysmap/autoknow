-- CreateTable
CREATE TABLE "InitiativeDevice" (
    "id" SERIAL NOT NULL,
    "initiativePartnerId" INTEGER NOT NULL,
    "projectId" INTEGER NOT NULL,

    CONSTRAINT "InitiativeDevice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InitiativeDevice_projectId_idx" ON "InitiativeDevice"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "InitiativeDevice_initiativePartnerId_projectId_key" ON "InitiativeDevice"("initiativePartnerId", "projectId");

-- AddForeignKey
ALTER TABLE "InitiativeDevice" ADD CONSTRAINT "InitiativeDevice_initiativePartnerId_fkey" FOREIGN KEY ("initiativePartnerId") REFERENCES "InitiativePartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InitiativeDevice" ADD CONSTRAINT "InitiativeDevice_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
