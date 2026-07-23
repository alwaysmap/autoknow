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

/** Full teardown for unit tests — closes the client AND the pg pool so jest exits. */
export async function disconnectTestDb() {
  await prisma.$disconnect();
  await pool.end();
}
