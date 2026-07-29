import type { Config } from 'jest'
import nextJest from 'next/jest.js'
// NOTE this file cannot import from tests/ — jest transpiles the config on its own, so a
// relative TypeScript import fails to resolve at runtime. Hence the knob is parsed here
// and tests/global-setup reads the RESOLVED count back off jest's globalConfig, which
// makes the two agree by construction rather than by a shared constant.
const JEST_WORKERS = Number(process.env.JEST_WORKERS) || 4
 
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
  // Runs in every test file's process BEFORE its imports are evaluated, so no suite can
  // reach the live Gemini API on a machine whose .env has a key — see the file for the
  // full story. It has to be `setupFiles` (not `setupFilesAfterEnv`) because
  // src/lib/gemini captures the key at import time, and imports are hoisted.
  setupFiles: ['<rootDir>/tests/no-live-gemini.ts'],
  // Runs inside each test file's environment (after the framework is installed) to close
  // the app-side Prisma pool that src/lib/db caches on `global`. Without it that pool
  // leaks per file and, under maxWorkers: 1, connections accumulate across the whole run
  // toward Postgres's max_connections — see tests/close-app-pool.ts for the full story.
  setupFilesAfterEnv: ['<rootDir>/tests/close-app-pool.ts'],
  // The main checkout hosts Claude Code worktrees under .claude/ — without this, jest
  // discovers each worktree's copy of the tests and the duplicates race on the test DB.
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/.claude/', '<rootDir>/.next'],
  // One database per worker, provisioned by tests/global-setup off this very number.
  //
  // This was maxWorkers:1 for as long as the suites shared ONE *_test database: several
  // wipe it, so running them at once clobbered fixtures. Giving each worker its own
  // database — the fix e2e already had — removes the constraint rather than living with
  // it. The run is dominated by waiting on Postgres, not by CPU (a serial run measured
  // ~45-60s at ~45% of a single core), which is exactly the shape that parallelises.
  maxWorkers: JEST_WORKERS,
  // 28 suites call wipeAll() (25 sequential deleteMany round-trips) from `beforeAll`, so
  // the default 5000ms hook timeout governs it too. Under full-suite load that budget is
  // tight enough to fail on an UNRELATED PR — measured (autoknow-gj0): the suite alone
  // 0.4s, pristine main under full-suite load 169s total / red on wipeAll's beforeAll at
  // 5000ms, an immediate re-run 143s / green. Nothing about the assertions changed
  // between runs, only contention — so raise the ceiling globally (one place governing
  // the one shared cost, AGENTS lesson 7) rather than chase it file by file. Generous
  // enough to absorb load, not so generous it stops catching a genuine hang.
  testTimeout: 20_000,
}
 
// createJestConfig is exported this way to ensure that next/jest can load the Next.js config which is async
export default createJestConfig(config)
