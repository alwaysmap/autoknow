// Playwright global setup: one test database PER WORKER (the lane scheme is explained in
// tests/helpers/worktree.ts), provisioned before the suite runs. This is the ONLY process
// that sees the whole set — a worker knows just its own index, and a web server is handed
// just its own DATABASE_URL — so provisioning belongs here.
//
// NOTE this runs AFTER the web servers have started: Playwright sets its plugins up before
// global setup. That is safe because the servers connect lazily, on their first request,
// which cannot happen before the first test.

import { provisionTestDatabases } from './helpers/provisionTestDatabases';
import { e2eWorkers } from './helpers/worktree';

export default async function globalSetup() {
  await provisionTestDatabases(
    Array.from({ length: e2eWorkers() }, (_, index) => ({ runner: 'e2e' as const, index })),
  );
}
