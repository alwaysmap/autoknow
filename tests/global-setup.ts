// jest global setup: make sure the dedicated test databases exist and match the Prisma
// schema before any unit/integration test runs.
//
// ONE PER WORKER, for the same reason e2e provisions one per Playwright worker: several
// suites wipe the database they are given, so workers that share one clobber each other's
// fixtures mid-run. jest ran maxWorkers:1 against a single unsuffixed database until that
// changed.
//
// The count is read back off jest's OWN resolved config rather than recomputed from the
// environment. That is what makes a drift impossible: whatever jest decided to run is
// exactly what gets provisioned, and a worker can never land on a database nobody created.
// (jest.config.ts cannot share a helper with this file — jest transpiles the config alone,
// so a relative TypeScript import there fails to resolve.) Over-provisioning is harmless:
// creation is skipped when the database already exists, and jest running fewer workers
// than configured — in-band for a single file, say — just leaves the spares untouched.
//
// The `jest` lane keeps these names clear of e2e's `_w<n>` ones, so both suites can run at
// the same time. See tests/global-setup-e2e.ts for the Playwright side.

import type { Config } from '@jest/types';
import { provisionTestDatabases } from './helpers/provisionTestDatabases';

export default async function globalSetup(globalConfig: Config.GlobalConfig) {
  await provisionTestDatabases(
    Array.from({ length: globalConfig.maxWorkers }, (_, index) => ({
      runner: 'jest' as const,
      index,
    })),
  );
}
