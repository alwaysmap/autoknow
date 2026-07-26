// jest global setup: make sure the dedicated test database exists and matches the Prisma
// schema before any unit/integration test runs.
//
// ONE database, because jest runs maxWorkers:1 — several suites wipe it, so they must not
// overlap. `null` is the "no Playwright worker" index, i.e. the unsuffixed name that
// tests/helpers/db lands on outside a worker process. e2e provisions a set instead; see
// tests/global-setup-e2e.ts.

import { provisionTestDatabases } from './helpers/provisionTestDatabases';

export default async function globalSetup() {
  await provisionTestDatabases([null]);
}
