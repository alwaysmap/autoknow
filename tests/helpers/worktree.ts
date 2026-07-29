// Per-worktree test isolation. Concurrent git worktrees used to share ONE
// `autoknow_test` database and ONE Playwright port (:3130), so two sessions running
// tests at once clobbered each other: a partner deleted between a seed's create and
// its update ("No record was found for an update" — the black hole), fixtures wiped
// mid-run, and both runs fighting for one socket (AGENTS lesson 9).
//
// The cure is a token unique to THIS checkout. Every test entrypoint — jest, the
// Playwright web servers, both global setups — runs with cwd = the worktree root, so
// a hash of cwd is identical across them within a worktree and differs across
// worktrees. testDatabaseUrl() folds it into the DB name and playwright.config folds
// it into the port, so concurrent worktrees are isolated by construction.
//
// WITHIN a worktree, BOTH runners split again by worker, for the same reason: a suite
// wipes its database, so two workers sharing one clobber each other's fixtures. e2e gives
// each Playwright worker a database AND a web server bound to it (e2eWorkers below); jest
// gives each of its workers a database (jestWorkers below) and needs no server. The two
// lanes are named apart — `_w<n>` for Playwright, `_j<n>` for jest — so running both at
// once cannot land worker 0 of each on one database.

import { createHash } from 'node:crypto';

const digest = (input: string): Buffer => createHash('sha1').update(input).digest();

/** The size of the port block each worktree owns — the ceiling on e2eWorkers(). */
const MAX_WORKERS = 8;
/** 4 because a GitHub runner has 4 vCPU and the e2e job is the workflow's critical path. */
const DEFAULT_WORKERS = 4;

/**
 * How many Playwright workers run in parallel — and therefore how many test databases and
 * web servers a run provisions. `E2E_WORKERS` overrides it.
 *
 * Each worker costs one `next start` (~200MB) and one database, and both scale linearly.
 * This is the number that must not drift between the config's `workers`, the `webServer`
 * array and global-setup-e2e's provisioning loop. Hence: one function.
 */
export function e2eWorkers(): number {
  const raw = process.env.E2E_WORKERS?.trim();
  if (!raw) return DEFAULT_WORKERS;
  const explicit = Number(raw);
  // Both refusals are loud on purpose. A typo'd knob that silently falls back to the
  // default, and a count that silently overflows this worktree's port block into the next
  // one's, both surface as an unreproducible fixture flake rather than as a bad setting.
  if (!Number.isInteger(explicit) || explicit <= 0) {
    throw new Error(`E2E_WORKERS must be a positive integer (got "${raw}").`);
  }
  if (explicit > MAX_WORKERS) {
    throw new Error(
      `E2E_WORKERS=${explicit} exceeds the ${MAX_WORKERS}-port block each worktree owns ` +
        '(tests/helpers/worktree.ts). Raise MAX_WORKERS if this is genuinely needed.',
    );
  }
  return explicit;
}

/**
 * Which worker THIS process belongs to, or null when there is no worker — jest, the
 * Playwright main process, global-setup. Playwright sets TEST_PARALLEL_INDEX in each
 * worker process; it is the parallel SLOT (0..workers-1), stable across the worker
 * restart that follows a crash, which TEST_WORKER_INDEX is not. The slot is what a
 * database and a server are bound to, so the slot is what we key on.
 */
export function e2eWorkerIndex(): number | null {
  const raw = parseInt(process.env.TEST_PARALLEL_INDEX ?? '', 10);
  return Number.isFinite(raw) && raw >= 0 ? raw : null;
}

/**
 * Which jest worker THIS process belongs to, or null outside one (global-setup, and any
 * non-jest caller). jest numbers its workers from 1 — including the in-band case, where a
 * single-file run still reports worker 1 — so the lane is JEST_WORKER_ID - 1, which lines
 * the jest lanes up with Playwright's 0-based slots and with the provisioning loop.
 *
 * There is deliberately no `jestWorkers()` twin of `e2eWorkers()`: jest's worker count
 * lives in jest.config.ts, and tests/global-setup reads it back off the resolved
 * globalConfig rather than recomputing it. A second definition here would be a number
 * that only LOOKS authoritative — the drift `e2eWorkers()`'s "one function" note warns of.
 */
export function jestWorkerIndex(): number | null {
  const raw = parseInt(process.env.JEST_WORKER_ID ?? '', 10);
  return Number.isFinite(raw) && raw >= 1 ? raw - 1 : null;
}

/**
 * One test database's identity: whose worker it belongs to, and which one. `null` — no
 * lane — is the unsuffixed database, which now belongs to no runner and is only what a
 * caller outside any worker (a script, a global setup asking about itself) resolves to.
 */
export interface TestLane {
  runner: 'e2e' | 'jest';
  index: number;
}

/**
 * The lane THIS process belongs to, which is what makes `testDatabaseUrl()` correct with
 * no argument in ~40 suites: they are evaluated inside a worker, so they land on that
 * worker's database. Playwright wins when both are set, because a spec runs inside a
 * Playwright worker whose environment jest may also have stamped.
 */
export function currentLane(): TestLane | null {
  const e2e = e2eWorkerIndex();
  if (e2e !== null) return { runner: 'e2e', index: e2e };
  const jest = jestWorkerIndex();
  if (jest !== null) return { runner: 'jest', index: jest };
  return null;
}

/**
 * Short, stable, filesystem-derived token identifying this worktree. `WORKTREE_ID`
 * overrides it — to pin a name in CI, or to deliberately share a DB across processes.
 */
export function worktreeToken(): string {
  const explicit = process.env.WORKTREE_ID?.replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (explicit) return explicit.slice(0, 12);
  return digest(process.cwd()).toString('hex').slice(0, 8);
}

/**
 * The Playwright web-server port for `workerIndex` in this worktree: a deterministic
 * offset off 3130 (kept clear of :3000 dev and :3100 demo) so two worktrees' e2e runs
 * never fight for one socket. `TEST_SERVER_PORT` overrides the base. Defaults to the
 * CALLER's own worker, matching testDatabaseUrl — inside a worker the port and the
 * database must name the same lane, and a default of 0 would quietly break that.
 *
 * The per-worktree base advances in strides of MAX_WORKERS rather than by 1, so a
 * worktree owns a whole BLOCK of ports and no two checkouts' blocks can interleave.
 * Sizing the stride off a constant rather than off e2eWorkers() keeps the blocks fixed:
 * a run with `E2E_WORKERS=8` must not renumber every other worktree's ports.
 */
export function testServerPort(workerIndex = e2eWorkerIndex() ?? 0): number {
  const explicit = parseInt(process.env.TEST_SERVER_PORT ?? '', 10);
  if (Number.isFinite(explicit)) return explicit + workerIndex;
  const h = digest(worktreeToken());
  const block = ((h[0] << 8) | h[1]) % 50;
  return 3130 + block * MAX_WORKERS + workerIndex; // 3130..3529, in blocks of 8
}
