import { pgPool } from './db';

// Single-flight for the cron worker: a second overlapping tick acquires nothing and
// no-ops (#57, and ADR ingestion-sized-for-hundreds-gate-the-10k-rebuild decision 5).
// README Flow 2 advertised this guard before it existed; this is the guard.
//
// WHY it matters: two Cloud Run instances can both be handed a tick when one runs long
// or Scheduler retries, and two concurrent cycles double-spend the Gemini budget and
// race ContextRevision writes.
//
// THE TRAP, and why this takes a client from the pool instead of using prisma:
// a Postgres advisory lock is SESSION-scoped, so it is held by the connection that
// took it and can only be released by that same connection. `prisma.$queryRaw` picks
// an arbitrary pooled connection per call, so lock-then-unlock through Prisma would
// unlock a connection that never held it — the unlock silently returns false, the real
// lock leaks until that connection happens to close, and every later tick no-ops.
// Holding one client for the whole critical section is what makes this correct.
//
// NOT `pg_try_advisory_xact_lock`, which would be simpler: that is transaction-scoped,
// and this critical section is a multi-minute cycle of external API calls. Holding an
// interactive transaction open that long blocks vacuum and exceeds Prisma's
// transaction timeout — the cure would be worse than the race.
//
// Crash safety comes free: a session lock is released when the connection drops, so an
// instance that dies mid-cycle does not wedge the lock. That is the reason to prefer
// it over a `locked_at` column, which needs a staleness heuristic to recover.

/** Distinct per critical section. Arbitrary but STABLE — changing it disables the guard.
 *  Deliberately NOT the `4771` that docs/DEPLOYMENT_GCP.md §2 once sketched: that snippet
 *  was never implemented, and keeping a different key makes it obvious which is live. */
export const REFRESH_LOCK_KEY = 5715701;

/**
 * The outcome, discriminated rather than `T | null`: a skipped run and a `work` that
 * legitimately resolves null (or void) must not be the same value. The first caller
 * whose work returns nothing would otherwise get a "skipped" branch that silently
 * means the wrong thing at a call site that looks correct.
 */
export type SingleFlightResult<T> = { ran: true; value: T } | { ran: false };

/** Run `work` iff the advisory lock is free; otherwise skip — a no-op tick, not an error. */
export async function withSingleFlight<T>(
  key: number,
  work: () => Promise<T>,
): Promise<SingleFlightResult<T>> {
  const client = await pgPool.connect();
  let held = false;
  try {
    const { rows } = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock($1) AS locked',
      [key],
    );
    held = rows[0]?.locked === true;
    if (!held) return { ran: false };
    return { ran: true, value: await work() };
  } finally {
    // Only unlock what we actually took: pg_advisory_unlock on a lock this session
    // does not hold logs a warning and returns false. In `finally` so a throw inside
    // `work` still releases rather than holding until the connection closes.
    if (held) await client.query('SELECT pg_advisory_unlock($1)', [key]);
    client.release();
  }
}
