// The single source of truth for which database tests may touch. It derives a
// dedicated `<name>_<worktree>_test` database from DATABASE_URL, so even a
// misconfigured environment can NEVER point the test suite at the real database — the
// name is forced to end in `_test`, and we fail hard if that somehow isn't true. The
// per-worktree segment (tests/helpers/worktree) keeps concurrent checkouts on separate
// databases so their fixture wipes can't collide (AGENTS lesson 9).

import { worktreeToken } from './worktree';

export function testDatabaseUrl(): string {
  // Explicit opt-out: an operator or CI can pin the exact test DB via
  // TEST_DATABASE_URL (no per-worktree token injected), still forced to end in _test.
  const explicit = process.env.TEST_DATABASE_URL;
  if (explicit) {
    const url = new URL(explicit);
    const name = url.pathname.replace(/^\//, '') || 'autoknow';
    if (!name.endsWith('_test')) url.pathname = `/${name}_test`;
    return assertTestName(url);
  }

  const base = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/autoknow';
  const url = new URL(base);
  // Strip any existing `_test` suffix so the base name is stable whether DATABASE_URL
  // points at `autoknow` or `autoknow_test`, then rebuild as `<base>_<worktree>_test`:
  // unique per checkout, still ending in `_test` (the wipe guard keys on that suffix).
  const baseName = (url.pathname.replace(/^\//, '') || 'autoknow').replace(/_test$/, '');
  url.pathname = `/${baseName}_${worktreeToken()}_test`;
  return assertTestName(url);
}

function assertTestName(url: URL): string {
  if (!url.pathname.endsWith('_test')) {
    throw new Error(`Refusing to run tests: database name must end in "_test" (got ${url.pathname})`);
  }
  return url.toString();
}
