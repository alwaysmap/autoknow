// Playwright global setup: make sure the dedicated test database exists and matches
// the Prisma schema before the test web server boots. Runs against `<name>_test` only
// (testDatabaseUrl enforces it) — the real database is never touched.

import { execSync } from 'node:child_process';
import { Client } from 'pg';
import { testDatabaseUrl } from './helpers/testDatabaseUrl';

export default async function globalSetup() {
  const url = new URL(testDatabaseUrl());
  const dbName = url.pathname.slice(1);

  // Create the test database if missing (connect via the maintenance database).
  const admin = new URL(url.toString());
  admin.pathname = '/postgres';
  const client = new Client({ connectionString: admin.toString() });
  await client.connect();
  const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (exists.rowCount === 0) {
    await client.query(`CREATE DATABASE "${dbName}"`);
  }
  await client.end();

  // Sync the schema (also creates the pgvector extension declared in schema.prisma).
  // --accept-data-loss: the *_test database is disposable (fixtures wipe it), and a
  // schema change that needs confirmation (e.g. a new unique constraint) must never
  // wedge the suite behind an interactive prompt.
  execSync('npx prisma db push --accept-data-loss', {
    env: { ...process.env, DATABASE_URL: url.toString() },
    stdio: 'pipe',
  });
}
