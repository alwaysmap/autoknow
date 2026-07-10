import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';
import { testDatabaseUrl } from './tests/helpers/testDatabaseUrl';

dotenv.config({ path: path.resolve(__dirname, '.env') });

// The suite runs against ITS OWN Next server on :3100, bound to the dedicated
// `<name>_test` database (tests/helpers/testDatabaseUrl.ts — the name is forced to end
// in `_test`, so the suite can never touch the real database). Auth and Gemini are
// explicitly unconfigured so behavior is deterministic: stub identity, no AI calls.
const TEST_DB = testDatabaseUrl();

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  globalSetup: './tests/global-setup',
  /* Every spec seeds by wiping the ONE shared test database in beforeAll, so spec files
     must never run concurrently — parallel workers clobber each other's fixtures. */
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? 'html' : 'line',
  use: {
    baseURL: 'http://localhost:3100',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npm run dev -- -p 3100',
    url: 'http://localhost:3100/login',
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: TEST_DB,
      NEXT_DIST_DIR: '.next-test', // keep the dev server on :3000 uncorrupted
      AUTH_GOOGLE_ID: '',
      AUTH_GOOGLE_SECRET: '',
      GEMINI_API_KEY: '',
      ADMIN_TOKEN: '',
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
});
