// Create the disposable test databases and sync the Prisma schema into them. Called from
// both global setups — tests/global-setup.ts (jest: one database) and
// tests/global-setup-e2e.ts (Playwright: one per worker) — which differ only in how many
// they ask for. Runs against `<name>_test` names only; testDatabaseUrl enforces that, so
// the real database can never be a target.

import { execFile } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Client } from 'pg';
import { testDatabaseUrl } from './testDatabaseUrl';
import type { TestLane } from './worktree';

const execFileAsync = promisify(execFile);

const MIGRATIONS_DIR = 'prisma/migrations';

/**
 * Every `ADD CONSTRAINT … EXCLUDE …` statement in the migration history, taken FROM the
 * migrations so there is one spelling of each.
 *
 * `prisma db push` syncs schema.prisma, and schema.prisma cannot say "exclusion
 * constraint" — Prisma has no syntax for one. So a test database built by `db push`
 * silently lacks every constraint of that kind, and a suite running against it would
 * prove that writes Postgres will refuse in production are fine. #127 E9's
 * unique-at-an-instant constraint is the first; this replays it and any that follow.
 *
 * Deliberately NOT "just run migrate deploy instead": these databases are wiped and
 * rebuilt constantly and `db push` is seconds where a replay of the whole history is not
 * — and the drift `db push` is reproached for here is exactly one statement kind.
 */
export function unmanagedConstraintSql(): string[] {
  const statements: string[] = [];
  for (const dir of readdirSync(MIGRATIONS_DIR).sort()) {
    const file = join(MIGRATIONS_DIR, dir, 'migration.sql');
    let sql: string;
    try {
      sql = readFileSync(file, 'utf8');
    } catch {
      continue; // migration_lock.toml and anything else that is not a migration directory
    }
    // Comments first, because these migrations explain themselves at length and a header
    // paragraph QUOTING the DDL below it would otherwise be extracted as a statement and
    // executed against every test database.
    const stripped = sql.replace(/^\s*--.*$/gm, '');
    // `[^;]*` and not `[\s\S]*?`, which is the same pattern with a hole in it: a lazy run
    // crosses statement boundaries happily, so `ALTER TABLE … DROP COLUMN …; … ALTER TABLE
    // … ADD CONSTRAINT … EXCLUDE …;` would match as ONE statement, pass the EXCLUDE
    // filter, and run that DROP COLUMN against every test database. Case-insensitive
    // throughout, because a migration written in lower case would otherwise be skipped in
    // silence — which is the exact failure this whole function exists to prevent.
    for (const match of stripped.matchAll(/ALTER TABLE[^;]*ADD CONSTRAINT[^;]*EXCLUDE\s+USING[^;]*;/gi)) {
      statements.push(match[0].trim());
    }
  }
  return statements;
}

/**
 * @param lanes One entry per database to provision: a worker lane (Playwright's or
 *   jest's), or `null` for the unsuffixed database a single-server run uses.
 */
export async function provisionTestDatabases(lanes: (TestLane | null)[]): Promise<void> {
  const urls = lanes.map((lane) => new URL(testDatabaseUrl(lane)));

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

  // Sync the schema (also creates the extensions declared in schema.prisma — pgvector,
  // and btree_gist, which the constraints replayed below are written in terms of).
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

  // Then the constraints `db push` cannot know about (see `unmanagedConstraintSql`).
  // Idempotent by asking pg_constraint first — these databases are reused across runs,
  // and a duplicate_object error on the second run would fail the whole suite before a
  // single test had a chance to run.
  const statements = unmanagedConstraintSql();
  if (statements.length === 0) return;
  await Promise.all(
    urls.map(async (url) => {
      const db = new Client({ connectionString: url.toString() });
      await db.connect();
      try {
        for (const sql of statements) {
          const name = sql.match(/ADD CONSTRAINT\s+"([^"]+)"/)?.[1];
          if (!name) throw new Error(`Could not read a constraint name out of: ${sql}`);
          const has = await db.query('SELECT 1 FROM pg_constraint WHERE conname = $1', [name]);
          if (has.rowCount === 0) await db.query(sql);
        }
      } finally {
        await db.end();
      }
    }),
  );
}
