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
//   • cron  : OFF by default. The refresh cycle is the demo's only unattended spender of
//             real Gemini quota, and a demo left open all afternoon is not a reason to
//             burn a daily free-tier budget. Trigger a cycle by hand whenever you want
//             one (the command is printed on boot), or pass `--cron` to restore the
//             self-driving interval for a session where watching content arrive on its
//             own IS the point.
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
// Opt in to the self-driving refresh interval. Off by default so the demo never spends
// Gemini quota in the background — see the `cron` note in the header.
const CRON = process.argv.includes('--cron');

// Local-only cron credential. The refresh route refuses to run at all without one
// (api/cron/refresh), which is the behaviour we want in prod and the one thing standing
// between this demo and a self-driving ingestion cycle.
// The secret stays wired whether or not the ticker runs, because it is also what makes a
// MANUAL cycle possible: the route refuses to run without one, so an unset secret would
// take "refresh on demand" away along with the automation.
const CRON_SECRET = `demo-${TOKEN}`;
// How often `--cron` drives a refresh cycle. Fast enough to watch, and self-limiting:
// once the fixture's authored revisions are exhausted every later tick short-circuits at
// Gate 1 and spends no Gemini at all (lib/refresh).
const TICK_MS = 15_000;
// The admin's free-tier knob (IngestionSettings), raised for the demo so a tick covers a
// useful slice of the corpus instead of two rows. It changes how FAST the fixture drains,
// not how much it can ever spend — that ceiling is the number of authored revisions.
//
// Deliberately kept UNDER the free-tier line the settings slider draws (100 docs/day ≈
// 192 requests/day against a 250 default): a demo must not configure the app into the
// state its own UI flags in warning ink. Set once per demo run, so changing it in
// Manage → Sources to watch the budget bite stays changed.
const DEMO_DAILY_BUDGET_DOCS = 100; // → perCycleBudget() = 4 per cycle, 8 requests
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
    // The route answers 200 with a per-document count even when Gemini refused some of
    // the corpus (autoknow-j81), so "seeded" is not the whole story — say how many
    // sources are actually there, or the demo silently reads as source-less.
    const body = (await res.json().catch(() => null)) as
      | { corpus?: { ingested: number; skipped: { key: string; reason: string }[] } }
      | null;
    const skipped = body?.corpus?.skipped ?? [];
    console.log(res.ok ? `• ✓ mock data seeded (${secs(seedMs)})` : `• ✗ seed failed (${res.status})`);
    if (skipped.length > 0) {
      console.log(`•   ${skipped.length} source(s) not ingested — ${skipped[0].reason}`);
    }
  } else {
    console.log('• demo DB already has data — skipping seed (pass --reseed to refresh)');
  }
  return { bootMs: readyAt - spawnedAt, seedMs };
}

const secs = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

/** The cron route's JSON response, in the shape this script reads it. Not imported from
 *  lib/refresh: ts-node runs this file as an ES module, so a relative import would need a
 *  file extension (same constraint as worktreeToken above). Every field is optional
 *  because a single-flight skip returns `{ skipped: true }` and nothing else. */
interface RefreshCycleResponse {
  checked?: number;
  changed?: number;
  frozen?: number;
  errors?: number;
  skipped?: boolean;
}

/** Point the demo's ingestion budget at DEMO_DAILY_BUDGET_DOCS. Once per run, before the
 *  ticker starts, so changing it in Manage → Sources afterwards stays changed. */
async function applyDemoBudget(): Promise<void> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO "IngestionSettings" ("key", "dailyReingestBudgetDocs", "updatedAt")
       VALUES ('default', $1, now())
       ON CONFLICT ("key") DO UPDATE SET "dailyReingestBudgetDocs" = $1, "updatedAt" = now()`,
      [DEMO_DAILY_BUDGET_DOCS],
    );
  } finally {
    await client.end();
  }
}

/**
 * Drive the real refresh cycle on an interval (`--cron`), so re-ingested content shows up
 * on its own — when that is what you are demonstrating, the point is that nobody clicks
 * Refresh on a programme or person page. This is the same endpoint Cloud Scheduler hits
 * in production; the demo is only supplying the schedule, which is exactly why it is
 * opt-in: an interval this fast against a real key is a background quota drain.
 *
 * Time is compressed through REFRESH_MAX_CADENCE_SECONDS (set on the server below)
 * rather than by touching any row — see lib/refresh.cadenceScale for why that direction
 * and not the other. Every gate, budget, hash comparison, re-distillation and freeze is
 * then the production path against untouched data.
 */
function startRefreshTicker(): void {
  let firstReport = true;

  const tick = async (): Promise<void> => {
    try {
      const res = await fetch(`${ORIGIN}/api/cron/refresh`, {
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      });
      if (!res.ok) {
        console.log(`• refresh tick failed (${res.status})`);
        return;
      }
      const report = (await res.json()) as RefreshCycleResponse;
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
  await applyDemoBudget();
  if (CRON) startRefreshTicker();

  // The tool reports its own bring-up cost — answers "how long from scratch" without
  // any external timing.
  const seedPart = seedMs != null ? `seed ${secs(seedMs)}` : 'seed skipped';
  console.log(`\n  ▶  AutoKnow demo running at ${ORIGIN}`);
  console.log(`     from scratch: ${secs(Date.now() - startedAt)}  (schema ${secs(schemaMs)} · boot ${secs(bootMs)} · ${seedPart})`);
  console.log(
    process.env.GEMINI_API_KEY
      ? '     Gemini key present — real digests + embeddings, and real quota spend'
      : '     NO GEMINI_API_KEY — digests are excerpts, embeddings are the fallback ' +
        'pedestal, and re-ingests produce no delta',
  );
  if (CRON) {
    console.log(`     refresh cycle: every ${TICK_MS / 1000}s (--cron)\n`);
  } else {
    // Printed in full rather than described, so "update when I feel like it" is a paste
    // away. The same endpoint Cloud Scheduler hits in prod, driven by hand.
    console.log('     refresh cycle: ON DEMAND — nothing spends Gemini in the background.');
    console.log(`       curl -H 'authorization: Bearer ${CRON_SECRET}' ${ORIGIN}/api/cron/refresh`);
    console.log('       (or re-run with --cron for the self-driving interval)\n');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
