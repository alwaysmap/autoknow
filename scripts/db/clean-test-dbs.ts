// Reclaim per-worktree test databases (npm run db:test:clean).
//
// Every git worktree provisions its own `autoknow_<token>_test` database on first test
// run, plus one `…_w<n>_test` per Playwright worker on first e2e run
// (tests/helpers/worktree + the two global setups), and NOTHING ever drops them, so they
// accumulate per worktree and per worker forever. This sweep drops every idle
// `autoknow…_test` database on the local server; a database with open connections
// (a suite running right now, or a stray psql/Studio) is left alone and reported.
//
// Safe by the same rule as lib/dbSafety's wipe guard: it only ever targets databases
// whose name ends in `_test`, so the real `autoknow` dev DB — and the demo/scratch
// DBs, which don't carry that suffix — are never touched. Warm-DB creation stays lazy
// in global-setup; this is the explicit, manual "reclaim the stragglers" command.

import { Client } from 'pg';

async function main(): Promise<void> {
  const base = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/autoknow';
  const admin = new URL(base);
  admin.pathname = '/postgres'; // connect through the maintenance DB, never a target

  const client = new Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    // `\_` escapes LIKE's single-char wildcard so it matches a literal underscore:
    // catches `autoknow_test` and `autoknow_<token>_test`, not `autoknow_demo_scratch`
    // (no `_test` suffix) nor the real `autoknow` DB.
    const { rows } = await client.query<{ datname: string; conns: string }>(
      `SELECT d.datname,
              (SELECT count(*) FROM pg_stat_activity a WHERE a.datname = d.datname) AS conns
         FROM pg_database d
        WHERE d.datname LIKE 'autoknow%\\_test' ESCAPE '\\'
        ORDER BY d.datname`,
    );

    if (rows.length === 0) {
      console.log('No autoknow *_test databases found — nothing to clean.');
      return;
    }

    let dropped = 0;
    let skipped = 0;
    for (const { datname, conns } of rows) {
      // Belt-and-suspenders: never drop anything that isn't a `_test` database.
      if (!datname.endsWith('_test')) {
        console.log(`skip  ${datname} (not a _test database — guarded)`);
        skipped++;
        continue;
      }
      if (Number(conns) > 0) {
        console.log(`skip  ${datname} (${conns} open connection(s) — in use)`);
        skipped++;
        continue;
      }
      try {
        // Identifier comes from pg_database and matched a strict pattern; quote anyway.
        await client.query(`DROP DATABASE IF EXISTS "${datname.replace(/"/g, '""')}"`);
        console.log(`drop  ${datname}`);
        dropped++;
      } catch (err) {
        // A connection can appear between the check and the drop; Postgres then refuses.
        // Treat that as "in use", not a failure.
        console.log(`skip  ${datname} (became busy during drop: ${(err as Error).message})`);
        skipped++;
      }
    }
    console.log(`\nDone: dropped ${dropped}, skipped ${skipped} of ${rows.length} test database(s).`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
