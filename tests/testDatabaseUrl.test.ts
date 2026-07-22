/** @jest-environment node */
import { testDatabaseUrl } from './helpers/testDatabaseUrl';
import { worktreeToken, testServerPort } from './helpers/worktree';

// Per-worktree test isolation (tests/helpers/worktree): the DB name and e2e port carry
// a token unique to the checkout, so concurrent worktrees stop clobbering one shared
// `autoknow_test` DB / one :3130 socket — WITHOUT ever weakening the invariant that the
// name ends in `_test` (the wipe guard in lib/dbSafety keys on exactly that).

function withEnv<T>(patch: Record<string, string | undefined>, fn: () => T): T {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(patch)) saved[k] = process.env[k];
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const DB = 'postgresql://u:p@h:5432/autoknow';
const dbNameOf = (u: string) => new URL(u).pathname.replace(/^\//, '');

describe('testDatabaseUrl — per-worktree isolation with the _test safety invariant', () => {
  it('ALWAYS yields a name ending in _test (lib/dbSafety keys on this)', () => {
    withEnv({ DATABASE_URL: DB, TEST_DATABASE_URL: undefined, WORKTREE_ID: 'alpha' }, () => {
      expect(dbNameOf(testDatabaseUrl())).toMatch(/_test$/);
    });
  });

  it('folds the worktree token in, so two checkouts get different databases', () => {
    const a = withEnv({ DATABASE_URL: DB, TEST_DATABASE_URL: undefined, WORKTREE_ID: 'alpha' }, testDatabaseUrl);
    const b = withEnv({ DATABASE_URL: DB, TEST_DATABASE_URL: undefined, WORKTREE_ID: 'beta' }, testDatabaseUrl);
    expect(dbNameOf(a)).toBe('autoknow_alpha_test');
    expect(dbNameOf(b)).toBe('autoknow_beta_test');
    expect(a).not.toBe(b);
  });

  it('does not double-suffix when DATABASE_URL already names a _test db', () => {
    const u = withEnv(
      { DATABASE_URL: 'postgresql://u:p@h:5432/autoknow_test', TEST_DATABASE_URL: undefined, WORKTREE_ID: 'alpha' },
      testDatabaseUrl,
    );
    expect(dbNameOf(u)).toBe('autoknow_alpha_test');
  });

  it('honors an explicit TEST_DATABASE_URL verbatim (CI/opt-out), still forcing _test', () => {
    const pinned = withEnv({ TEST_DATABASE_URL: 'postgresql://u:p@h:5432/pinned_test' }, testDatabaseUrl);
    expect(dbNameOf(pinned)).toBe('pinned_test');
    const coerced = withEnv({ TEST_DATABASE_URL: 'postgresql://u:p@h:5432/shared' }, testDatabaseUrl);
    expect(dbNameOf(coerced)).toBe('shared_test');
  });

  it('is stable within a worktree — same token, same URL across calls', () => {
    const once = withEnv({ DATABASE_URL: DB, TEST_DATABASE_URL: undefined, WORKTREE_ID: 'alpha' }, testDatabaseUrl);
    const twice = withEnv({ DATABASE_URL: DB, TEST_DATABASE_URL: undefined, WORKTREE_ID: 'alpha' }, testDatabaseUrl);
    expect(once).toBe(twice);
  });
});

describe('worktree token + e2e port', () => {
  it('token honors WORKTREE_ID, sanitized and capped at 12 chars', () => {
    expect(withEnv({ WORKTREE_ID: 'Feat/B-1' }, worktreeToken)).toBe('featb1'); // non-alnum stripped, lowercased
    expect(withEnv({ WORKTREE_ID: 'abcdefghijklmnop' }, worktreeToken)).toBe('abcdefghijkl'); // capped
  });

  it('port is deterministic per worktree and clear of the :3000/:3100 conventions', () => {
    const p1 = withEnv({ WORKTREE_ID: 'alpha', TEST_SERVER_PORT: undefined }, testServerPort);
    const p2 = withEnv({ WORKTREE_ID: 'alpha', TEST_SERVER_PORT: undefined }, testServerPort);
    expect(p1).toBe(p2);
    expect(p1).toBeGreaterThanOrEqual(3130);
    expect(p1).toBeLessThan(3530);
    expect([3000, 3100]).not.toContain(p1);
  });

  it('TEST_SERVER_PORT overrides the derived port', () => {
    expect(withEnv({ TEST_SERVER_PORT: '3999' }, testServerPort)).toBe(3999);
  });
});
