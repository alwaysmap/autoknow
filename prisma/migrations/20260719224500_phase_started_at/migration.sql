-- Additive: explicit work-started marker on Phase (cycle-time wait vs active split).
ALTER TABLE "Phase" ADD COLUMN "startedAt" TIMESTAMP(3);
