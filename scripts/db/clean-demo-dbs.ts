// Reclaim per-worktree DEMO databases whose worktree is gone (npm run db:demo:clean).
//
// `db:test:clean` reclaims `*_test`; nothing reclaimed `*_demo`, so they accumulated
// forever. Measured on one laptop before this existed: 13 demo databases, 148MB, most of
// them belonging to worktrees deleted weeks earlier — beside 153 stray `_test` databases
// holding 1.6GB, which is what that sibling exists for.
//
// The RULE IS DIFFERENT from its sibling's, deliberately. `db:test:clean` drops every
// idle `_test` database, because a test database is rebuilt by the next test run and
// belongs to nobody. A DEMO database is somebody's working seeded app — `npm run demo`
// is idempotent precisely so you can come back to it — so this drops only the ones whose
// WORKTREE NO LONGER EXISTS. Same reconciliation as `docker:reap`, one level down: the
// desired state is "a demo database exists iff its worktree does".
//
// The name carries the identity: `scripts/dev/demo.ts` names the database
// `autoknow_<token>_demo` where the token is sha1(worktree path).slice(0,8). So the live
// set is computable from `git worktree list` alone, with no bookkeeping to go stale.
//
// LIMIT, stated rather than hidden: `demo.ts` lets `WORKTREE_ID` override the derived
// token. A demo database created under an explicit WORKTREE_ID cannot be matched back to
// a path, so it is reported and LEFT ALONE rather than guessed at.
//
// Safe by the same rule as its sibling: it only ever targets names ending `_demo`, so the
// real `autoknow` dev DB and every `_test` database are untouchable here, and a database
// with open connections (a demo running right now) is skipped and reported.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { Client } from 'pg';

/** Kept in sync with tests/helpers/worktree.ts and scripts/dev/demo.ts by construction:
 *  all three derive the token the same way, from the checkout's absolute path. */
const tokenOf = (worktreePath: string): string =>
  createHash('sha1').update(worktreePath).digest('hex').slice(0, 8);

function liveWorktreeTokens(): Set<string> {
  const out = execFileSync('git', ['worktree', 'list', '--porcelain'], { encoding: 'utf8' });
  const paths = out.split('\n')
    .filter((l) => l.startsWith('worktree '))
    .map((l) => l.slice('worktree '.length).trim())
    .filter(Boolean);
  return new Set(paths.map(tokenOf));
}

async function main(): Promise<void> {
  const base = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/autoknow';
  const admin = new URL(base);
  admin.pathname = '/postgres'; // connect through the maintenance DB, never a target

  const live = liveWorktreeTokens();
  const client = new Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    // `\_` escapes LIKE's single-char wildcard so it matches a literal underscore.
    const { rows } = await client.query<{ datname: string; conns: string }>(
      `SELECT d.datname,
              (SELECT count(*) FROM pg_stat_activity a WHERE a.datname = d.datname) AS conns
         FROM pg_database d
        WHERE d.datname LIKE 'autoknow\\_%\\_demo' ESCAPE '\\'
        ORDER BY d.datname`,
    );

    if (rows.length === 0) {
      console.log('No autoknow *_demo databases found — nothing to clean.');
      return;
    }

    let dropped = 0;
    let kept = 0;
    for (const { datname, conns } of rows) {
      // Belt-and-suspenders: never drop anything that isn't a `_demo` database.
      if (!datname.endsWith('_demo')) {
        console.log(`skip  ${datname} (not a _demo database — guarded)`);
        kept++;
        continue;
      }
      const token = datname.replace(/^autoknow_/, '').replace(/_demo$/, '');
      if (live.has(token)) {
        console.log(`keep  ${datname} (worktree present)`);
        kept++;
        continue;
      }
      // A token that matches no live worktree is either a dead worktree (the case this
      // exists for) or an explicit WORKTREE_ID we cannot resolve to a path. Length is the
      // only tell: a derived token is exactly 8 hex characters.
      if (!/^[0-9a-f]{8}$/.test(token)) {
        console.log(`skip  ${datname} (explicit WORKTREE_ID — cannot match it to a path)`);
        kept++;
        continue;
      }
      if (Number(conns) > 0) {
        console.log(`skip  ${datname} (${conns} open connection(s) — in use)`);
        kept++;
        continue;
      }
      try {
        await client.query(`DROP DATABASE IF EXISTS "${datname.replace(/"/g, '""')}"`);
        console.log(`drop  ${datname}`);
        dropped++;
      } catch (err) {
        console.log(`fail  ${datname}: ${(err as Error).message}`);
        kept++;
      }
    }
    console.log(`\nDone: dropped ${dropped}, kept ${kept} of ${rows.length} demo database(s).`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
