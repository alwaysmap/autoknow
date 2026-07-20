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

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  globalSetup: './tests/global-setup',
  /* Every spec seeds by wiping the ONE shared test database in beforeAll, so spec files
     must never run concurrently — parallel workers clobber each other's fixtures. */
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // One local retry: under heavy desktop load the dev server's first-interaction
  // hydration can lag beyond even generous in-test guards; isolated runs are stable.
  retries: process.env.CI ? 2 : 1,
  workers: 1,
  reporter: process.env.CI ? 'html' : 'line',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  webServer: {
    command: `npm run dev -- -p ${PORT}`,
    url: `${BASE_URL}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: TEST_DB,
      NEXT_DIST_DIR: '.next-test', // keep the dev server on :3000 uncorrupted
      AUTH_GOOGLE_ID: '',
      AUTH_GOOGLE_SECRET: '',
      GEMINI_API_KEY: '',
      ADMIN_TOKEN: '',
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
