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
// The lane is passed EXPLICITLY throughout this describe, because these cases are about
// the stem and the worktree token. Left to default, it would resolve to this jest
// worker's own lane and every expected name below would grow a `_j<n>` segment — the
// suffix is the next describe's subject, not this one's.
const base = () => testDatabaseUrl(null);

describe('testDatabaseUrl — per-worktree isolation with the _test safety invariant', () => {
  it('ALWAYS yields a name ending in _test (lib/dbSafety keys on this)', () => {
    withEnv({ DATABASE_URL: DB, TEST_DATABASE_URL: undefined, WORKTREE_ID: 'alpha' }, () => {
      expect(dbNameOf(base())).toMatch(/_test$/);
    });
  });

  it('folds the worktree token in, so two checkouts get different databases', () => {
    const a = withEnv({ DATABASE_URL: DB, TEST_DATABASE_URL: undefined, WORKTREE_ID: 'alpha' }, base);
    const b = withEnv({ DATABASE_URL: DB, TEST_DATABASE_URL: undefined, WORKTREE_ID: 'beta' }, base);
    expect(dbNameOf(a)).toBe('autoknow_alpha_test');
    expect(dbNameOf(b)).toBe('autoknow_beta_test');
    expect(a).not.toBe(b);
  });

  it('does not double-suffix when DATABASE_URL already names a _test db', () => {
    const u = withEnv(
      { DATABASE_URL: 'postgresql://u:p@h:5432/autoknow_test', TEST_DATABASE_URL: undefined, WORKTREE_ID: 'alpha' },
      base,
    );
    expect(dbNameOf(u)).toBe('autoknow_alpha_test');
  });

  it('honors an explicit TEST_DATABASE_URL verbatim (CI/opt-out), still forcing _test', () => {
    const pinned = withEnv({ TEST_DATABASE_URL: 'postgresql://u:p@h:5432/pinned_test' }, base);
    expect(dbNameOf(pinned)).toBe('pinned_test');
    const coerced = withEnv({ TEST_DATABASE_URL: 'postgresql://u:p@h:5432/shared' }, base);
    expect(dbNameOf(coerced)).toBe('shared_test');
  });

  it('is stable within a worktree — same token, same URL across calls', () => {
    const once = withEnv({ DATABASE_URL: DB, TEST_DATABASE_URL: undefined, WORKTREE_ID: 'alpha' }, base);
    const twice = withEnv({ DATABASE_URL: DB, TEST_DATABASE_URL: undefined, WORKTREE_ID: 'alpha' }, base);
    expect(once).toBe(twice);
  });
});

describe('testDatabaseUrl — the per-worker lane', () => {
  const env = { DATABASE_URL: DB, TEST_DATABASE_URL: undefined, WORKTREE_ID: 'alpha' };
  const named = (lane: Parameters<typeof testDatabaseUrl>[0]) =>
    withEnv(env, () => dbNameOf(testDatabaseUrl(lane)));

  // `w` and `j` are what keep the two runners apart. Both suites can be running at once,
  // and both wipe what they are given, so one shared name is a fixture-eating race — the
  // AGENTS lesson 9 failure, one level down from the per-worktree token.
  it('names Playwright lanes _w<n> and jest lanes _j<n>', () => {
    expect(named({ runner: 'e2e', index: 0 })).toBe('autoknow_alpha_w0_test');
    expect(named({ runner: 'e2e', index: 3 })).toBe('autoknow_alpha_w3_test');
    expect(named({ runner: 'jest', index: 0 })).toBe('autoknow_alpha_j0_test');
    expect(named({ runner: 'jest', index: 3 })).toBe('autoknow_alpha_j3_test');
  });

  it('never gives the same name to the two runners at one index', () => {
    for (const index of [0, 1, 2, 3]) {
      expect(named({ runner: 'e2e', index })).not.toBe(named({ runner: 'jest', index }));
    }
  });

  it('appends the lane even under an explicit TEST_DATABASE_URL', () => {
    const pinned = withEnv({ TEST_DATABASE_URL: 'postgresql://u:p@h:5432/pinned_test' }, () =>
      dbNameOf(testDatabaseUrl({ runner: 'jest', index: 2 })),
    );
    expect(pinned).toBe('pinned_j2_test');
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
