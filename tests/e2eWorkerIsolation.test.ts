/** @jest-environment node */
// The e2e suite's isolation is per WORKER (tests/helpers/worktree.ts has the full account).
// Three separate things have to agree for it to hold, and all three fail SILENTLY — a spec
// pointed at the wrong server still passes most of the time, and only turns into an
// unreproducible fixture flake under load. So they are asserted here, in the cheap suite,
// rather than left to review (AGENTS lesson 2).
//
// The other half of that invariant — that jest's lanes never collide with these — is a
// property of how names are BUILT, so it is asserted in tests/testDatabaseUrl.test.ts,
// with the naming module.

import { readFileSync } from 'node:fs';
import { testDatabaseUrl } from './helpers/testDatabaseUrl';
import { sourceFiles, stripComments } from './helpers/sourceFiles';
import { e2eWorkers, testServerPort } from './helpers/worktree';

// RECURSIVE, via the shared walker: tests/api/ is a whole directory of specs that a flat
// readdir misses, and missing it is how the first run of this change failed.
const specs = (): string[] => sourceFiles('tests').filter((f) => f.endsWith('.spec.ts'));

describe('e2e worker isolation', () => {
  // A spec that imports `test` from '@playwright/test' gets the base `test`, whose
  // `baseURL` option nothing fills in — playwright.config.ts deliberately leaves it unset
  // because the value is per-worker. Its own database is still correct (that comes from
  // the process env, not the import), so the symptom is a worker seeding fixtures it then
  // cannot reach: every `page.goto('/…')` fails on a relative URL with no base.
  //
  // Comments are stripped first: a comment mentioning the module is not an import of it,
  // and this file's own prose proves how easily that false positive arises.
  it('every spec takes its `test` from tests/helpers/e2e, never from @playwright/test', () => {
    const offenders = specs().filter((f) =>
      stripComments(readFileSync(f, 'utf8')).includes('@playwright/test'),
    );
    expect(offenders).toEqual([]);
  });

  // Anti-vacuity partner: the scan above is worthless if the helper stops being the thing
  // that binds a worker to a port. Asserted on the CONCEPT, not one spelling — destructuring
  // `parallelIndex` is an ordinary edit and must not fail here with an unrelated message.
  it('the helper the specs import derives baseURL from the worker index', () => {
    const helper = readFileSync('tests/helpers/e2e.ts', 'utf8');
    expect(helper).toMatch(/baseURL:/);
    expect(helper).toMatch(/parallelIndex/);
    expect(helper).toMatch(/testServerPort\(/);
  });

  it('gives every worker a distinct database and a distinct port', () => {
    const indices = Array.from({ length: e2eWorkers() }, (_, i) => i);
    const dbs = indices.map((index) => testDatabaseUrl({ runner: 'e2e', index }));
    const ports = indices.map((i) => testServerPort(i));

    expect(new Set(dbs).size).toBe(indices.length);
    expect(new Set(ports).size).toBe(indices.length);
    // Every name still ends in `_test` — testDatabaseUrl throws otherwise, but the suffix
    // is the wipe guard's entire basis, so assert it rather than assume it.
    for (const db of dbs) expect(new URL(db).pathname).toMatch(/_test$/);
  });

  // The demo server (:3100) and the dev server (:3000) are long-lived and hold real data;
  // a worker that landed on either would drive e2e fixtures into it.
  it('keeps every worker clear of the dev and demo ports', () => {
    for (let i = 0; i < e2eWorkers(); i++) {
      expect([3000, 3100]).not.toContain(testServerPort(i));
      expect(testServerPort(i)).toBeGreaterThanOrEqual(3130);
    }
  });
});
