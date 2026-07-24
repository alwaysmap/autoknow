// Wired into jest via `setupFilesAfterEnv`, so this runs inside EVERY test file's
// environment. Its one job: close the app-side Prisma client and pool that src/lib/db
// caches on `global`, at the end of each file.
//
// Why it has to exist: src/lib/db.ts caches its PrismaClient and pg Pool on `global`
// whenever NODE_ENV !== 'production' — which includes jest (NODE_ENV=test). Any suite
// that exercises app code (a route handler, a lib query) transitively imports
// src/lib/db and opens that pool, but nothing ever closed it: tests/helpers/db's
// disconnectTestDb() closes only the separate TEST pool. Because `npm run test` runs
// serially in one long-lived worker (jest.config maxWorkers: 1), those app pools leak
// and their connections accumulate across files — sampling pg_stat_activity during a
// full run showed the count climbing to ~42 against the *_test DB. Not a failure today,
// but a latent flake as the suite grows toward Postgres's max_connections ceiling.
//
// Why it READS `global` instead of importing a teardown helper from src/lib/db:
// importing that module here would evaluate it at setup time — before any test body
// runs — binding its pool to whatever DATABASE_URL is ambient then (the dev DB), not
// the per-worktree `*_test` DB. DB suites deliberately set DATABASE_URL and only THEN
// dynamically import src/lib/db (see the qa skill) so the app client lands on the test
// DB; evaluating it early here would silently defeat that guard. So we never import it —
// we only close the cache a suite's own correctly-bound import already populated, which
// makes this a no-op in files that never opened the pool.
//
// This touches ONLY the app pool; the per-suite TEST pool is a different object still
// owned by disconnectTestDb(), so the two teardowns are independent and their order
// relative to each other never matters.

import type { Pool } from 'pg';
import type { PrismaClient } from '@prisma/client';

// Best-effort close: a failed teardown must never fail an otherwise-green file.
async function closeQuietly(close: () => Promise<unknown>): Promise<void> {
  try {
    await close();
  } catch {
    // Swallow — teardown is best-effort, per the note above.
  }
}

afterAll(async () => {
  const globalForPrisma = global as unknown as { prisma?: PrismaClient; pgPool?: Pool };
  const { prisma, pgPool } = globalForPrisma;
  if (prisma) await closeQuietly(() => prisma.$disconnect());
  if (pgPool) await closeQuietly(() => pgPool.end());
});
