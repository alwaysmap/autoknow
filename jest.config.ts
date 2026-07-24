import type { Config } from 'jest'
import nextJest from 'next/jest.js'
 
const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files in your test environment
  dir: './',
})
 
// Add any custom config to be passed to Jest
const config: Config = {
  coverageProvider: 'v8',
  testEnvironment: 'jsdom',
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  preset: 'ts-jest',
  // Ensure the dedicated `<name>_test` database exists and matches the schema before
  // any unit/integration test runs. Tests import tests/helpers/db, which is hard-bound
  // to the *_test database — they can never touch the real one.
  globalSetup: '<rootDir>/tests/global-setup.ts',
  // Runs inside each test file's environment (after the framework is installed) to close
  // the app-side Prisma pool that src/lib/db caches on `global`. Without it that pool
  // leaks per file and, under maxWorkers: 1, connections accumulate across the whole run
  // toward Postgres's max_connections — see tests/close-app-pool.ts for the full story.
  setupFilesAfterEnv: ['<rootDir>/tests/close-app-pool.ts'],
  // The main checkout hosts Claude Code worktrees under .claude/ — without this, jest
  // discovers each worktree's copy of the tests and the duplicates race on the test DB.
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/.claude/', '<rootDir>/.next'],
  // Several suites wipe/seed the ONE shared *_test database (same rule as the
  // Playwright config: fixtures must never run concurrently). The suite is small;
  // serial is cheap and deterministic.
  maxWorkers: 1,
}
 
// createJestConfig is exported this way to ensure that next/jest can load the Next.js config which is async
export default createJestConfig(config)
