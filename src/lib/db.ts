import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const globalForPrisma = global as unknown as { prisma?: PrismaClient; pgPool?: Pool };

const connectionString = process.env.DATABASE_URL;

// The Pool is cached on global alongside the client: each dev/HMR re-evaluation of
// this module used to construct a fresh 10-connection Pool that nothing ever closed
// (the cached PrismaClient keeps its original adapter, so new pools were pure leak).
const pool = globalForPrisma.pgPool ?? new Pool({ connectionString });
const adapter = new PrismaPg(pool);

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
  globalForPrisma.pgPool = pool;
}


