// The single source of truth for which database tests may touch. It derives a
// dedicated `<name>_<worktree>[_w<n>]_test` database from DATABASE_URL, so even a
// misconfigured environment can NEVER point the test suite at the real database — the
// name is forced to end in `_test`, and we fail hard if that somehow isn't true. The
// per-worktree segment keeps concurrent checkouts on separate databases, and the
// per-worker segment does the same for the Playwright workers within one run, so no two
// fixture wipes can collide (tests/helpers/worktree, AGENTS lesson 9).

import { currentLane, worktreeToken, type TestLane } from './worktree';

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

/**
 * @param lane Whose worker's database, and which one. Defaults to the caller's own lane
 *   (null outside any worker), which is what makes tests/helpers/db correct with no
 *   argument: it is imported INSIDE a worker process — Playwright's or jest's — so it
 *   lands on that worker's database. playwright.config.ts and both global setups run in a
 *   MAIN process and must therefore pass a lane explicitly; they are provisioning other
 *   processes' databases, not their own.
 */
export function testDatabaseUrl(lane: TestLane | null = currentLane()): string {
  // Explicit opt-out: an operator or CI can pin the base name via TEST_DATABASE_URL (no
  // per-worktree token injected).
  const explicit = process.env.TEST_DATABASE_URL;
  if (explicit) return testDbUrl(new URL(explicit), lane);

  let base = process.env.DATABASE_URL;
  if (!base) {
    announceDbFallback();
    base = DEFAULT_DB_URL;
  }
  return testDbUrl(new URL(base), lane, worktreeToken());
}

/**
 * Rebuild `url`'s database name as `<stem>[_<worktree>][_w<n>|_j<n>]_test`. Any existing
 * `_test` suffix is stripped first, so the stem is stable whether DATABASE_URL points at
 * `autoknow` or `autoknow_test`, and the result always ends in `_test` — the wipe guard
 * keys on that. The lane segment is appended even under TEST_DATABASE_URL, because it is
 * not a preference: two workers on one database wipe each other's fixtures.
 *
 * `w` for Playwright and `j` for jest, so the two runners' lanes cannot collide. They are
 * separate processes with separate worker numbering, and both suites can be running at
 * once — without the letter, Playwright worker 0 and jest worker 0 would name one
 * database and wipe each other mid-run.
 */
function testDbUrl(url: URL, lane: TestLane | null, worktree?: string): string {
  const stem = (url.pathname.replace(/^\//, '') || 'autoknow').replace(/_test$/, '');
  const segment = lane === null ? undefined : `${lane.runner === 'e2e' ? 'w' : 'j'}${lane.index}`;
  const parts = [stem, worktree, segment, 'test'];
  url.pathname = `/${parts.filter(Boolean).join('_')}`;
  return assertTestName(url);
}

function assertTestName(url: URL): string {
  if (!url.pathname.endsWith('_test')) {
    throw new Error(`Refusing to run tests: database name must end in "_test" (got ${url.pathname})`);
  }
  return url.toString();
}
