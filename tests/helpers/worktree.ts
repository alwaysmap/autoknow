// Per-worktree test isolation. Concurrent git worktrees used to share ONE
// `autoknow_test` database and ONE Playwright port (:3130), so two sessions running
// tests at once clobbered each other: a partner deleted between a seed's create and
// its update ("No record was found for an update" — the black hole), fixtures wiped
// mid-run, and both runs fighting for one socket (AGENTS lesson 9).
//
// The cure is a token unique to THIS checkout. Every test entrypoint — jest, the
// Playwright web server, tests/global-setup — runs with cwd = the worktree root, so
// a hash of cwd is identical across them within a worktree and differs across
// worktrees. testDatabaseUrl() folds it into the DB name and playwright.config folds
// it into the port, so concurrent worktrees are isolated by construction while a
// single worktree stays on one stable DB/port (its own suites still run serially —
// workers=1 — because they share that one DB).

import { createHash } from 'node:crypto';

const digest = (input: string): Buffer => createHash('sha1').update(input).digest();

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
 * The Playwright dev-server port for this worktree: a deterministic offset off 3130
 * (kept clear of :3000 dev and :3100 demo) so two worktrees' e2e runs never fight for
 * one socket. `TEST_SERVER_PORT` overrides.
 */
export function testServerPort(): number {
  const explicit = process.env.TEST_SERVER_PORT;
  if (explicit) {
    const n = parseInt(explicit, 10);
    if (Number.isFinite(n)) return n;
  }
  const h = digest(worktreeToken());
  return 3130 + (((h[0] << 8) | h[1]) % 400); // 3130..3529
}
