import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';
import { testDatabaseUrl } from './tests/helpers/testDatabaseUrl';
import { e2eWorkers, testServerPort } from './tests/helpers/worktree';

dotenv.config({ path: path.resolve(__dirname, '.env') });

// The suite runs against ITS OWN Next servers (NEVER :3100 — that is the long-lived demo
// server), one per worker, each bound to that worker's `_test` database. The lane scheme
// and why it exists are in tests/helpers/worktree.ts; what matters here is that the count
// comes from e2eWorkers() so `workers`, the `webServer` array and global-setup-e2e cannot
// disagree. Auth and Gemini are explicitly unconfigured so behavior is deterministic:
// stub identity, no AI calls.
const WORKERS = e2eWorkers();
const PORTS = Array.from({ length: WORKERS }, (_, worker) => testServerPort(worker));

// Under a PRODUCTION server (below), `requireRouteAuth` is fail-closed when auth is
// unconfigured: it admits everything only when NODE_ENV !== 'production', and otherwise
// demands a valid x-admin-token (src/lib/routeAuth.ts). `next dev` satisfied the first
// branch; a prod build does not, so the suite authenticates the way real admin tooling /
// integrations do — a shared token, set in the server env and sent on every request.
const E2E_ADMIN_TOKEN = 'e2e-admin-token';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  globalSetup: './tests/global-setup-e2e',
  /* Every spec seeds by wiping ITS WORKER's database in beforeAll. Files are safe to run
     concurrently because each worker owns a database and a server (see WORKERS below);
     tests WITHIN a file are not, because they share that one wipe — so parallelism stops
     at the file boundary. */
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // Retries are a thin net for genuine transients (a dropped DB connection), NOT a
  // flake-masker. e2e now runs against a prod build (see webServer), so the dev-server
  // first-hit compilation lag that once justified 2 CI retries is gone. Was `CI ? 2 : 1`;
  // lowered when the suite moved to the prod build.
  //
  // This once claimed the remaining retry keeps a real flake VISIBLE, failing on the
  // second attempt rather than being retried into a false green. It does not: a flake
  // that fails attempt 1 and passes the retry is reported FLAKY, the process exits 0,
  // and the check is green — which is how autoknow-dxa survived three PRs. Judge a flake
  // fix from the log (no `Retry #1`), never from the tick, until `failOnFlakyTests` is
  // switched on (bead autoknow-zbt).
  // docs/knowledge/a-test-that-passes-on-retry-reports-the-check-green.md
  retries: process.env.CI ? 1 : 0,
  // One worker per (server, database) pair provisioned below — never more, or the extra
  // workers would land on a port nothing is listening on.
  workers: WORKERS,
  reporter: process.env.CI ? 'html' : 'line',
  use: {
    // NO baseURL here: it is per-worker, and the config has no worker to ask. Specs
    // import `test` from tests/helpers/e2e, whose fixture supplies it.
    trace: 'on-first-retry',
    // Authorize API/mutation routes on the prod server (see E2E_ADMIN_TOKEN). Harmless on
    // page navigations; identity still resolves to the stub via the session, so who-am-I
    // semantics are unchanged — this grants authorization, not a different user.
    extraHTTPHeaders: { 'x-admin-token': E2E_ADMIN_TOKEN },
  },
  // ONE SERVER PER WORKER, serving a PRODUCTION build (`next build` + `next start`), NOT
  // `next dev`. Dev compiled each route on first request, so under CI load first-hit compilation blew
  // page.goto's 30s budget and server-action round-trips lagged past their assertion
  // timeouts — the whole class of flakes the suite was leaning on `retries` to hide
  // (webkit /programs/[id]: phase_graph goto timeouts, needle dialog-close and hill-note
  // reflect races). A prod server precompiles every route and serves fast and
  // deterministically, so those timings stop depending on runner load.
  //
  // The build itself happens ONCE, before Playwright starts, in the `test:e2e:*` scripts
  // — four servers building concurrently into one `.next-test` would corrupt it, and
  // building four times would cost more than the parallelism saves. So these commands
  // only start. Run `npx playwright test` directly and you serve whatever build is on
  // disk; that is why the npm scripts are the supported entrypoint (AGENTS).
  webServer: PORTS.map((port, worker) => ({
    command: `npm run start -- -p ${port}`,
    url: `http://localhost:${port}/login`,
    reuseExistingServer: false,
    timeout: 120_000, // starting a prebuilt server is seconds; headroom for a loaded runner
    env: {
      DATABASE_URL: testDatabaseUrl(worker),
      NEXT_DIST_DIR: '.next-test', // serve the e2e build, keeping the :3000 dev server's .next uncorrupted
      AUTH_GOOGLE_ID: '', // empty → no providers → stub identity (src/auth.ts)
      AUTH_GOOGLE_SECRET: '',
      // A prod server THROWS without a secret where dev only warns; set a throwaway one so
      // the stub-identity path runs cleanly. `authConfigured` keys off the GOOGLE creds
      // above, so this does NOT enable real auth — every session still resolves to the stub.
      AUTH_SECRET: 'e2e-stub-identity-only-not-a-real-secret',
      GEMINI_API_KEY: '',
      ADMIN_TOKEN: E2E_ADMIN_TOKEN, // the token the suite presents (see use.extraHTTPHeaders)
      // Deterministic degraded states regardless of the operator's .env.
      CRON_SECRET: '',
      GOOGLE_SERVICE_ACCOUNT_JSON: '',
      GOOGLE_APPLICATION_CREDENTIALS: '',
    },
  })),
  projects: [
    // Chromium runs the full behavioral suite — the user base is Chrome-dominant
    // (internal Googler tool), so this is the truth-bearing run.
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: '**/phase_screenshots.spec.ts',
    },
    // WebKit is the divergent-engine canary, and ONLY where engines actually
    // diverge: <dialog closedby> fallback, <input type="month">, range inputs,
    // and SVG click/drag in the DAG editor. Running the engine-agnostic DOM
    // assertions (tables, filters, i18n, seeding) 3× tripled a serial suite for
    // no signal — Firefox was dropped for the same reason.
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      testMatch: /(projects_flow|project_details|phase_graph|needle)\.spec\.ts/,
    },
    // Screenshot artifacts for visual review (not assertions) — opt-in via
    // `npm run test:e2e:screens`, never part of the default run.
    {
      name: 'screens',
      use: { ...devices['Desktop Chrome'] },
      testMatch: '**/phase_screenshots.spec.ts',
    },
  ],
});
