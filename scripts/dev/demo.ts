// One-command worktree demo (npm run demo): a per-worktree Postgres database seeded
// with mock data, served by `next dev` with a stub signed-in identity. Replaces the
// old manual recipe (create DB → db push → hand-edit launch.json → seed via /admin).
//
//   • DB    : autoknow_<worktree-token>_demo — own DB per checkout; persists across
//             restarts, and NOT a `_test` DB, so `npm run db:test:clean` won't touch it.
//   • port  : per-worktree (3600–3899), clear of :3000 dev, :3100 demo, e2e (~3130).
//   • auth  : AUTH_GOOGLE_* empty → stub signed-in identity, no Google login.
//   • Gemini: PASSED THROUGH from your environment. With a key, the seeded corpus is
//             really distilled and really embedded, so semantic search and the
//             cross-programme themes in lib/mockCorpus actually work; without one the
//             app degrades honestly (digests become excerpts, embeddings become the
//             fallback pedestal, and no re-ingestion delta is produced).
//   • seed  : mock data goes through the app's own API routes (the only place
//             seedMockData works — server-only), so it's driven against the running
//             server via /api/admin/seed. Idempotent: skips seeding when the DB
//             already has data; pass `--reseed` to wipe + reseed.
//   • cron  : the refresh cycle is driven on an interval (below), so re-ingested
//             content arrives on its own — nobody clicks Refresh anywhere.
//
// The dev server runs in the foreground (Ctrl-C stops it), so its logs stream as usual.

// `.env` first, the way prisma.config.ts does it. ts-node does NOT load .env on its own
// — only `next dev` does, and only for the child. Without this the checks below read an
// empty environment and then pass THAT to the child, where an explicit '' beats the
// .env the child would otherwise have loaded: the demo would blank out the Gemini key
// the developer actually has. dotenv never overrides an already-set variable, so an
// explicit `GEMINI_API_KEY= npm run demo` still wins.
import 'dotenv/config';

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

// A missing DATABASE_URL means a missing .env, which a fresh worktree cannot
// inherit (scripts/dev/link-env.sh). Say so rather than silently demoing against
// whatever happens to be on localhost — the demo looking healthy while pointed at
// the wrong database is the expensive failure here.
const DEFAULT_DB_URL = 'postgresql://postgres:postgres@localhost:5432/autoknow';
if (!process.env.DATABASE_URL) {
  console.warn(
    `No DATABASE_URL set — using ${DEFAULT_DB_URL}. In a fresh worktree run ` +
      '`npm run postinstall` to link .env from the main checkout.',
  );
}
const BASE = new URL(process.env.DATABASE_URL || DEFAULT_DB_URL);
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

// Local-only cron credential. The refresh route refuses to run at all without one
// (api/cron/refresh), which is the behaviour we want in prod and the one thing standing
// between this demo and a self-driving ingestion cycle.
const CRON_SECRET = `demo-${TOKEN}`;
// How often the demo drives a refresh cycle. Fast enough to watch, and self-limiting:
// once the fixture's authored revisions are exhausted every later tick short-circuits at
// Gate 1 and spends no Gemini at all (lib/refresh).
const TICK_MS = 15_000;
// The admin's free-tier knob (IngestionSettings), raised for the demo so a tick covers a
// useful slice of the corpus instead of two rows. It changes how FAST the fixture drains,
// not how much it can ever spend — that ceiling is the number of authored revisions.
//
// Deliberately kept UNDER the free-tier line the settings slider draws (100 docs/day ≈
// 200 requests/day against a 250 default): a demo must not configure the app into the
// state its own UI flags in warning ink. Set once per demo run, so changing it in
// Manage → Sources to watch the budget bite stays changed.
const DEMO_DAILY_BUDGET_DOCS = 100; // → perCycleBudget() = 4 per cycle
// Compress lib/refresh's cadence table so its slowest class (a week) comes round in this
// many seconds — the demo's substitute for waiting a week, applied to SCHEDULING rather
// than to any row's data. Slightly longer than a tick, so each tick finds fresh work.
const DEMO_MAX_CADENCE_SECONDS = 20;

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

/** Wait for the dev server, seed if needed. Returns the phase timings (ms) so the
 *  tool self-reports bring-up cost — no external instrumentation needed. */
async function seedWhenReady(spawnedAt: number): Promise<{ bootMs: number; seedMs: number | null }> {
  process.stdout.write('• waiting for the dev server');
  let readyAt = 0;
  for (let i = 0; i < 240; i++) {
    try {
      await fetch(`${ORIGIN}/api/health`); // any response means the socket is listening
      readyAt = Date.now();
      break;
    } catch {
      process.stdout.write('.');
      await sleep(500);
    }
  }
  process.stdout.write('\n');
  if (!readyAt) {
    console.error('• dev server did not come up in time — seed skipped');
    return { bootMs: 0, seedMs: null };
  }

  let seedMs: number | null = null;
  if (RESEED || (await partnerCount()) === 0) {
    console.log('• seeding mock data via /api/admin/seed …');
    const startedSeed = Date.now();
    const res = await fetch(`${ORIGIN}/api/admin/seed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'mock' }),
    });
    seedMs = Date.now() - startedSeed;
    console.log(res.ok ? `• ✓ mock data seeded (${secs(seedMs)})` : `• ✗ seed failed (${res.status})`);
  } else {
    console.log('• demo DB already has data — skipping seed (pass --reseed to refresh)');
  }
  return { bootMs: readyAt - spawnedAt, seedMs };
}

const secs = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

interface CycleResult {
  checked?: number; changed?: number; frozen?: number; errors?: number; backlog?: number;
  skipped?: boolean;
}

/**
 * Drive the real refresh cycle on an interval, so re-ingested content shows up on its
 * own — the point of the exercise is that nobody clicks Refresh on a programme or
 * person page. This is the same endpoint Cloud Scheduler hits in production; the demo
 * is only supplying the schedule.
 *
 * The one thing the demo compresses is TIME, and it does that through
 * REFRESH_MAX_CADENCE_SECONDS (set on the server below), not by touching data: nobody
 * will leave a demo running for a week to watch the web cadence come round. Every gate,
 * budget, hash comparison, re-distillation and freeze is then the production path,
 * against untouched rows.
 *
 * The rejected alternative was backdating each row's lastCheckedAt to force it due. It
 * works, and it quietly lies: the feed and Manage → Sources RENDER lastCheckedAt, so the
 * demo would report "checked eight days ago" about a source it checked four seconds ago
 * — in the same UI whose whole job is telling you how fresh things are.
 */
function startRefreshTicker(): void {
  const client = new Client({ connectionString: DB_URL });
  let connected = false;
  let firstReport = true;

  const tick = async (): Promise<void> => {
    try {
      if (!connected) {
        await client.connect();
        await client.query(
          `INSERT INTO "IngestionSettings" ("key", "dailyReingestBudgetDocs", "updatedAt")
           VALUES ('default', $1, now())
           ON CONFLICT ("key") DO UPDATE SET "dailyReingestBudgetDocs" = $1, "updatedAt" = now()`,
          [DEMO_DAILY_BUDGET_DOCS],
        );
        connected = true;
      }
      const res = await fetch(`${ORIGIN}/api/cron/refresh`, {
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      });
      if (!res.ok) {
        console.log(`• refresh tick failed (${res.status})`);
        return;
      }
      const report = (await res.json()) as CycleResult;
      if (report.skipped) return; // single-flight: another tick still running

      const { checked = 0, changed = 0, frozen = 0, errors = 0 } = report;
      // Quiet by default: only say something when the cycle actually did something,
      // or on the first tick so it is visible that the ticker is alive at all.
      if (changed || frozen || errors || firstReport) {
        console.log(
          `• refresh cycle: ${checked} checked, ${changed} re-ingested, ${frozen} frozen` +
            (errors ? `, ${errors} errors` : ''),
        );
        firstReport = false;
      }
    } catch (e) {
      console.log(`• refresh tick error: ${(e as Error).message}`);
    }
  };

  const timer = setInterval(() => void tick(), TICK_MS);
  timer.unref?.(); // never hold the process open on the ticker's account
  void tick();
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  await ensureDatabase();

  console.log('• syncing schema (prisma db push) …');
  const startedSchema = Date.now();
  execFileSync('npm', ['run', 'db:push'], { env: { ...process.env, DATABASE_URL: DB_URL }, stdio: 'inherit' });
  const schemaMs = Date.now() - startedSchema;

  // The seed runs in parallel with the server it targets; the dev process stays in the
  // foreground so Ctrl-C stops the demo.
  const spawnedAt = Date.now();
  const server = spawn('npm', ['run', 'dev', '--', '-p', String(PORT)], {
    env: {
      ...process.env,
      DATABASE_URL: DB_URL,
      DESTRUCTIVE_DB_ALLOWED: DB, // lets the admin seed route pass lib/dbSafety's wipe guard
      NEXT_DIST_DIR: '.next-preview', // keep any :3000 dev server's build dir uncorrupted
      AUTH_GOOGLE_ID: '',
      AUTH_GOOGLE_SECRET: '',
      // Passed through, not blanked: with a key the seeded corpus gets real digests and
      // real embeddings, which is the only way the cross-programme themes in
      // lib/mockCorpus are findable and the only way a re-ingest produces a delta.
      GEMINI_API_KEY: process.env.GEMINI_API_KEY ?? '',
      ADMIN_TOKEN: '', // admin ops allowed in non-prod without a token
      CRON_SECRET, // lets the demo drive the refresh cycle on a schedule
      REFRESH_MAX_CADENCE_SECONDS: String(DEMO_MAX_CADENCE_SECONDS),
    },
    stdio: 'inherit',
  });
  server.on('exit', (code) => process.exit(code ?? 0));
  // Forward Ctrl-C / termination to the dev server so the demo stops cleanly.
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => server.kill(sig));

  const { bootMs, seedMs } = await seedWhenReady(spawnedAt);
  startRefreshTicker();

  // The tool reports its own bring-up cost — answers "how long from scratch" without
  // any external timing.
  const seedPart = seedMs != null ? `seed ${secs(seedMs)}` : 'seed skipped';
  console.log(`\n  ▶  AutoKnow demo running at ${ORIGIN}`);
  console.log(`     from scratch: ${secs(Date.now() - startedAt)}  (schema ${secs(schemaMs)} · boot ${secs(bootMs)} · ${seedPart})`);
  console.log(
    process.env.GEMINI_API_KEY
      ? `     refresh cycle every ${TICK_MS / 1000}s · Gemini key present (real digests + embeddings)\n`
      : `     refresh cycle every ${TICK_MS / 1000}s · NO GEMINI_API_KEY — digests are excerpts, ` +
        `embeddings are the fallback pedestal, and re-ingests produce no delta\n`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
