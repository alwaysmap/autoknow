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
}
 
// createJestConfig is exported this way to ensure that next/jest can load the Next.js config which is async
export default createJestConfig(config)
