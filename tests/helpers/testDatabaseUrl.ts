// The single source of truth for which database tests may touch. It derives a
// dedicated `<name>_<worktree>_test` database from DATABASE_URL, so even a
// misconfigured environment can NEVER point the test suite at the real database — the
// name is forced to end in `_test`, and we fail hard if that somehow isn't true. The
// per-worktree segment (tests/helpers/worktree) keeps concurrent checkouts on separate
// databases so their fixture wipes can't collide (AGENTS lesson 9).

import { worktreeToken } from './worktree';

export const DEFAULT_DB_URL = 'postgresql://postgres:postgres@localhost:5432/autoknow';

// An ABSENT DATABASE_URL is not a configuration — it is a missing .env, which a
// fresh worktree cannot inherit (scripts/dev/link-env.sh). Inventing a connection
// string in silence is how one missing file becomes five unrelated-looking
// failures, so the fallback announces itself (AGENTS lesson 5: degrade with an
// honest message, never a faked result). Once per process — this is called by
// jest, global-setup and the Playwright config alike.
let announced = false;
export function announceDbFallback(): void {
  if (announced) return;
  announced = true;
  console.warn(
    `No DATABASE_URL set — using ${DEFAULT_DB_URL}. In a fresh worktree run ` +
      '`npm run postinstall` to link .env from the main checkout.',
  );
}

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

  let base = process.env.DATABASE_URL;
  if (!base) {
    announceDbFallback();
    base = DEFAULT_DB_URL;
  }
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
