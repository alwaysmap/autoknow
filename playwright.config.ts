import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';
import { testDatabaseUrl } from './tests/helpers/testDatabaseUrl';
import { testServerPort } from './tests/helpers/worktree';

dotenv.config({ path: path.resolve(__dirname, '.env') });

// The suite runs against ITS OWN Next server (NEVER :3100 — that is the long-lived
// demo server), bound to the dedicated `<name>_<worktree>_test` database
// (tests/helpers/testDatabaseUrl.ts — the name is forced to end in `_test`, so the
// suite can never touch the real database). Both the port and the DB carry a
// per-worktree token so two checkouts' e2e runs never collide on the socket or the
// fixtures (AGENTS lesson 9). Auth and Gemini are explicitly unconfigured so behavior
// is deterministic: stub identity, no AI calls.
const TEST_DB = testDatabaseUrl();
const PORT = testServerPort();
const BASE_URL = `http://localhost:${PORT}`;

// Under a PRODUCTION server (below), `requireRouteAuth` is fail-closed when auth is
// unconfigured: it admits everything only when NODE_ENV !== 'production', and otherwise
// demands a valid x-admin-token (src/lib/routeAuth.ts). `next dev` satisfied the first
// branch; a prod build does not, so the suite authenticates the way real admin tooling /
// integrations do — a shared token, set in the server env and sent on every request.
const E2E_ADMIN_TOKEN = 'e2e-admin-token';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  globalSetup: './tests/global-setup',
  /* Every spec seeds by wiping the ONE shared test database in beforeAll, so spec files
     must never run concurrently — parallel workers clobber each other's fixtures. */
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // Retries are a thin net for genuine transients (a dropped DB connection), NOT a
  // flake-masker. e2e now runs against a prod build (see webServer), so the dev-server
  // first-hit compilation lag that once justified 2 CI retries is gone — keep it at 1 so
  // a real flake fails VISIBLY on the second attempt instead of being retried into a
  // false green. Was `CI ? 2 : 1`; lowered when the suite moved to the prod build.
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'html' : 'line',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    // Authorize API/mutation routes on the prod server (see E2E_ADMIN_TOKEN). Harmless on
    // page navigations; identity still resolves to the stub via the session, so who-am-I
    // semantics are unchanged — this grants authorization, not a different user.
    extraHTTPHeaders: { 'x-admin-token': E2E_ADMIN_TOKEN },
  },
  webServer: {
    // Run e2e against a PRODUCTION build (`next build` + `next start`), NOT `next dev`.
    // Dev compiled each route on first request, so under CI load first-hit compilation
    // blew page.goto's 30s budget and server-action round-trips lagged past their
    // assertion timeouts — the whole class of flakes the suite was leaning on `retries`
    // to hide (webkit /programs/[id]: phase_graph goto timeouts, needle dialog-close and
    // hill-note reflect races). A prod server precompiles every route and serves fast and
    // deterministically, so those timings stop depending on runner load.
    command: `npm run build && npm run start -- -p ${PORT}`,
    url: `${BASE_URL}/login`,
    reuseExistingServer: false,
    timeout: 300_000, // a cold `next build` is ~1–2 min; generous headroom for a loaded CI runner
    env: {
      DATABASE_URL: TEST_DB,
      NEXT_DIST_DIR: '.next-test', // build+serve here, keeping the :3000 dev server's .next uncorrupted
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
  },
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
