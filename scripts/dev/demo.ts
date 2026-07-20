// One-command worktree demo (npm run demo): a per-worktree Postgres database seeded
// with mock data, served by `next dev` with a stub signed-in identity. Replaces the
// old manual recipe (create DB → db push → hand-edit launch.json → seed via /admin).
//
//   • DB    : autoknow_<worktree-token>_demo — own DB per checkout; persists across
//             restarts, and NOT a `_test` DB, so `npm run db:test:clean` won't touch it.
//   • port  : per-worktree (3600–3899), clear of :3000 dev, :3100 demo, e2e (~3130).
//   • auth  : AUTH_GOOGLE_* empty → stub signed-in identity, no Google login.
//   • Gemini: empty → no AI calls; the app degrades honestly.
//   • seed  : mock data goes through the app's own API routes (the only place
//             seedMockData works — server-only), so it's driven against the running
//             server via /api/admin/seed. Idempotent: skips seeding when the DB
//             already has data; pass `--reseed` to wipe + reseed.
//
// The dev server runs in the foreground (Ctrl-C stops it), so its logs stream as usual.

import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Client } from 'pg';

// Per-worktree token, kept in sync with tests/helpers/worktree.ts. Inlined (not
// imported) on purpose: ts-node runs this file as an ES module here, and an ESM
// relative import would need a file extension — a builtin like node:crypto does not.
function worktreeToken(): string {
  const explicit = process.env.WORKTREE_ID?.replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (explicit) return explicit.slice(0, 12);
  return createHash('sha1').update(process.cwd()).digest('hex').slice(0, 8);
}

const BASE = new URL(process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/autoknow');
const TOKEN = worktreeToken();
const DB = `autoknow_${TOKEN}_demo`;
const DB_URL = (() => {
  const u = new URL(BASE.toString());
  u.pathname = `/${DB}`;
  return u.toString();
})();
const PORT = 3600 + (parseInt(TOKEN.slice(0, 4), 16) % 300); // 3600..3899
const ORIGIN = `http://localhost:${PORT}`;
const RESEED = process.argv.includes('--reseed');

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function ensureDatabase(): Promise<void> {
  const admin = new URL(BASE.toString());
  admin.pathname = '/postgres'; // connect through the maintenance DB to CREATE
  const client = new Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [DB]);
    if (!rowCount) {
      await client.query(`CREATE DATABASE "${DB}"`);
      console.log(`• created database ${DB}`);
    } else {
      console.log(`• reusing database ${DB}`);
    }
  } finally {
    await client.end();
  }
}

async function partnerCount(): Promise<number> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    const { rows } = await client.query<{ n: number }>('SELECT count(*)::int AS n FROM "Partner"');
    return rows[0].n;
  } finally {
    await client.end();
  }
}

async function seedWhenReady(): Promise<void> {
  process.stdout.write('• waiting for the dev server');
  let up = false;
  for (let i = 0; i < 240; i++) {
    try {
      await fetch(`${ORIGIN}/api/health`); // any response means the socket is listening
      up = true;
      break;
    } catch {
      process.stdout.write('.');
      await sleep(500);
    }
  }
  process.stdout.write('\n');
  if (!up) {
    console.error('• dev server did not come up in time — seed skipped');
    return;
  }

  if (RESEED || (await partnerCount()) === 0) {
    console.log('• seeding mock data via /api/admin/seed …');
    const res = await fetch(`${ORIGIN}/api/admin/seed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'mock' }),
    });
    console.log(res.ok ? '• ✓ mock data seeded' : `• ✗ seed failed (${res.status})`);
  } else {
    console.log('• demo DB already has data — skipping seed (pass --reseed to refresh)');
  }
  console.log(`\n  ▶  AutoKnow demo running at ${ORIGIN}\n`);
}

async function main(): Promise<void> {
  await ensureDatabase();

  console.log('• syncing schema (prisma db push) …');
  execFileSync('npm', ['run', 'db:push'], { env: { ...process.env, DATABASE_URL: DB_URL }, stdio: 'inherit' });

  // The seed runs in parallel with the server it targets; the dev process stays in the
  // foreground so Ctrl-C stops the demo.
  const server = spawn('npm', ['run', 'dev', '--', '-p', String(PORT)], {
    env: {
      ...process.env,
      DATABASE_URL: DB_URL,
      DESTRUCTIVE_DB_ALLOWED: DB, // lets the admin seed route pass lib/dbSafety's wipe guard
      NEXT_DIST_DIR: '.next-preview', // keep any :3000 dev server's build dir uncorrupted
      AUTH_GOOGLE_ID: '',
      AUTH_GOOGLE_SECRET: '',
      GEMINI_API_KEY: '',
      ADMIN_TOKEN: '', // admin ops allowed in non-prod without a token
    },
    stdio: 'inherit',
  });
  server.on('exit', (code) => process.exit(code ?? 0));
  // Forward Ctrl-C / termination to the dev server so the demo stops cleanly.
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => server.kill(sig));

  await seedWhenReady();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
