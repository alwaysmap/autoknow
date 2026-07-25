import type { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { createResilientPool } from './pgPool';

const globalForPrisma = global as unknown as { prisma?: PrismaClient; pgPool?: Pool };

const connectionString = process.env.DATABASE_URL;

// The Pool is cached on global alongside the client: each dev/HMR re-evaluation of
// this module used to construct a fresh 10-connection Pool that nothing ever closed
// (the cached PrismaClient keeps its original adapter, so new pools were pure leak).
// createResilientPool retries a briefly-unreachable DB at connect time (Cloud SQL
// cold-starts in prod; the CI service container's startup blip) so one transient
// ECONNREFUSED no longer fails a request — see src/lib/pgPool.ts.

/** The raw pool behind Prisma. Exported for the ONE case Prisma cannot serve: work that
 *  must run on a single, known connection — a session-scoped advisory lock, whose
 *  release must happen on the same connection that took it (see src/lib/singleFlight.ts).
 *  Reach for `prisma` for everything else. */
export const pgPool = globalForPrisma.pgPool ?? createResilientPool({ connectionString });
const adapter = new PrismaPg(pgPool);

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
  globalForPrisma.pgPool = pgPool;
}


