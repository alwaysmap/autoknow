// The Prisma client for TESTS — bound to the dedicated `<name>_test` database and
// nothing else. Every spec and unit test imports `prisma` from here, never from
// src/lib/db (which points wherever DATABASE_URL points, i.e. potentially production).

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { testDatabaseUrl } from './testDatabaseUrl';
import { createResilientPool } from '../../src/lib/pgPool';

const url = testDatabaseUrl();

// Redundant hard guard — testDatabaseUrl() already enforces this, but a wipe against
// the wrong database is unrecoverable, so check again at the point of connection.
if (!new URL(url).pathname.endsWith('_test')) {
  throw new Error(`Test prisma client refused a non-test database: ${new URL(url).pathname}`);
}

// Same resilient pool as the app: teardown wipes (fixtures.wipeAll → deleteMany)
// were among the ops that hit ECONNREFUSED when the CI DB blipped, so the test
// client must tolerate a brief outage too.
const pool = createResilientPool({ connectionString: url });
export const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

/**
 * `orderBy` for reading back "the newest row this test just wrote" — timestamp, then id.
 *
 * The `id` tiebreak is not belt-and-braces: Prisma maps DateTime to MILLISECOND precision,
 * and two appends inside one test land in the same millisecond often enough to flake, at
 * which point `findFirst` may return either. The ACTIONS order by timestamp alone and are
 * right to — they ask a question about history, where a tie is rare and genuinely
 * ambiguous. A test that wrote both rows is not asking that question.
 */
export const newestFirst = [{ timestamp: 'desc' as const }, { id: 'desc' as const }];

/** Full teardown for unit tests — closes the client AND the pg pool so jest exits. */
export async function disconnectTestDb() {
  await prisma.$disconnect();
  await pool.end();
}
