/** @jest-environment node */
// The refresh cron must be single-flight (#57) — see lib/singleFlight for the why.
// README Flow 2 advertised this guard for months before it existed, so it ships with a
// test rather than a claim (AGENTS lessons 2 and 10).
//
// These run against the real *_test database, not a stub: the whole mechanism IS
// Postgres advisory-lock semantics, and the interesting failure — releasing on a
// different pooled connection than the one that took the lock — is invisible to a fake.

import { testDatabaseUrl } from './helpers/testDatabaseUrl';

process.env.DATABASE_URL = testDatabaseUrl();

let withSingleFlight: typeof import('../src/lib/singleFlight').withSingleFlight;
let pgPool: typeof import('../src/lib/db').pgPool;

/** Distinct from the app's real key so a failing run cannot wedge anything else. */
const KEY = 5715799;

beforeAll(async () => {
  ({ withSingleFlight } = await import('../src/lib/singleFlight'));
  ({ pgPool } = await import('../src/lib/db'));
});

// No afterAll: this suite drives the APP pool, which tests/close-app-pool.ts closes for
// every file. Importing tests/helpers/db just to close it would open a second pool.

/** How many advisory locks this key currently has across all sessions. */
const heldCount = async (): Promise<number> => {
  const { rows } = await pgPool.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM pg_locks WHERE locktype = 'advisory' AND objid = $1",
    [KEY],
  );
  return Number(rows[0].n);
};

describe('withSingleFlight', () => {
  it('runs the work and reports its result when the lock is free', async () => {
    await expect(withSingleFlight(KEY, async () => 'ran')).resolves.toEqual({ ran: true, value: 'ran' });
  });

  it('lets only ONE of two overlapping callers run', async () => {
    let running = 0;
    let concurrentPeak = 0;
    const work = async () => {
      running += 1;
      concurrentPeak = Math.max(concurrentPeak, running);
      // Hold the lock long enough that the second caller genuinely overlaps rather
      // than arriving after the first has finished.
      await new Promise((r) => setTimeout(r, 150));
      running -= 1;
      return 'ran';
    };

    const [a, b] = await Promise.all([withSingleFlight(KEY, work), withSingleFlight(KEY, work)]);

    // Exactly one ran; the other skipped rather than erroring.
    expect([a, b].filter((r) => r.ran)).toHaveLength(1);
    expect([a, b].filter((r) => !r.ran)).toHaveLength(1);
    // The real assertion: the engines never ran at the same time.
    expect(concurrentPeak).toBe(1);
  });

  it('releases the lock after the work resolves, so the next tick runs', async () => {
    await withSingleFlight(KEY, async () => 'first');
    expect(await heldCount()).toBe(0);
    await expect(withSingleFlight(KEY, async () => 'second')).resolves.toEqual({ ran: true, value: 'second' });
  });

  it('releases the lock when the work THROWS — otherwise one bad tick wedges every later one', async () => {
    await expect(withSingleFlight(KEY, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(await heldCount()).toBe(0);
    await expect(withSingleFlight(KEY, async () => 'after')).resolves.toEqual({ ran: true, value: 'after' });
  });

  it('does not release a lock it never took', async () => {
    // The skipped caller must not unlock the RUNNING one's lock. If it did, a third
    // tick could start mid-cycle — the race this guard exists to stop, reintroduced by
    // the guard itself.
    let heldDuringSkip = -1;
    await withSingleFlight(KEY, async () => {
      const skipped = await withSingleFlight(KEY, async () => 'should not run');
      expect(skipped.ran).toBe(false);
      heldDuringSkip = await heldCount();
      return 'outer';
    });
    expect(heldDuringSkip).toBe(1); // still exactly the outer caller's lock
    expect(await heldCount()).toBe(0);
  });
});
