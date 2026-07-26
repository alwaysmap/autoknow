// Create the disposable test databases and sync the Prisma schema into them. Called from
// both global setups — tests/global-setup.ts (jest: one database) and
// tests/global-setup-e2e.ts (Playwright: one per worker) — which differ only in how many
// they ask for. Runs against `<name>_test` names only; testDatabaseUrl enforces that, so
// the real database can never be a target.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Client } from 'pg';
import { testDatabaseUrl } from './testDatabaseUrl';

const execFileAsync = promisify(execFile);

/**
 * @param workerIndices One entry per database to provision: a Playwright worker index,
 *   or `null` for the unsuffixed database that jest and a single-server run use.
 */
export async function provisionTestDatabases(workerIndices: (number | null)[]): Promise<void> {
  const urls = workerIndices.map((i) => new URL(testDatabaseUrl(i)));

  // Create the missing databases over ONE maintenance connection — they all live on the
  // same server — and before any schema work, since `prisma db push` cannot create its
  // own target.
  const admin = new URL(urls[0].toString());
  admin.pathname = '/postgres';
  const client = new Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    for (const url of urls) {
      const dbName = url.pathname.slice(1);
      const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
      if (exists.rowCount === 0) await client.query(`CREATE DATABASE "${dbName}"`);
    }
  } finally {
    await client.end();
  }

  // Sync the schema (also creates the pgvector extension declared in schema.prisma).
  // --accept-data-loss: a *_test database is disposable (fixtures wipe it), and a schema
  // change that needs confirmation — a new unique constraint, say — must never wedge the
  // suite behind an interactive prompt.
  //
  // In parallel, because these are independent databases: serialising four ~4s pushes
  // would spend most of the head start parallel workers are here to buy.
  await Promise.all(
    urls.map((url) =>
      execFileAsync('npx', ['prisma', 'db', 'push', '--accept-data-loss'], {
        env: { ...process.env, DATABASE_URL: url.toString() },
      }),
    ),
  );
}
