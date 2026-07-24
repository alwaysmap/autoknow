import { Pool, type PoolClient, type PoolConfig } from 'pg';

// A pg.Pool that survives a briefly-unreachable Postgres.
//
// Why this exists: the e2e suite runs a prod-build server (playwright.config.ts)
// and the jest DB suites against a Postgres *service container* in CI. The
// container's health check (`pg_isready`, run inside the container) can report
// healthy a beat before the server accepts TCP on the mapped port, and while the
// server finishes starting it may accept a socket and immediately reset it. A
// plain pg.Pool does not retry a failed connection, so a single blip surfaces as
// `ECONNREFUSED`/`ECONNRESET` and fails the query outright — the intermittent
// e2e red chased on PR #100 (a CSS-only change that could not have caused it, and
// re-ran green). See the knowledge note
// db-service-container-econnrefused-needs-connect-retry.
//
// The safety rule that makes the retry sound: we ONLY ever retry connection
// *acquisition*. The SQL itself is dispatched exactly once, on an
// already-acquired client — so a write is never re-applied, no matter which
// connection-layer error we recover from. (Reproduced by stopping Postgres
// mid-query and restarting it: a plain pool fails; this one rides through.)

// Connection-layer error codes — raised while ESTABLISHING a connection, before
// any SQL is dispatched. Because we only wrap acquisition, every one of these is
// safe to retry, including ECONNRESET (a reset during the server's startup
// handshake). A query-execution failure carries a Postgres SQLSTATE instead and
// is never seen here.
const ACQUIRE_RETRYABLE = new Set([
  'ECONNREFUSED', // nothing listening yet on the mapped port
  'ECONNRESET', // socket accepted then dropped mid-handshake (server still starting)
  'ETIMEDOUT', // SYN sent, no reply within connectionTimeoutMillis
  'ENOTFOUND', // DNS not resolvable yet
  'EAI_AGAIN', // transient DNS failure
  '57P03', // Postgres up but "cannot connect now" — still starting (SQLSTATE)
]);

const codeOf = (err: unknown): unknown => (err as { code?: unknown } | null)?.code;

/** True only for errors raised while *acquiring* a connection — safe to retry. */
export function isRetryableConnectError(err: unknown): boolean {
  const code = codeOf(err);
  return typeof code === 'string' && ACQUIRE_RETRYABLE.has(code);
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface RetryOptions {
  /** Max retries after the first attempt for a connection failure (default 5). */
  retries?: number;
  /** Base backoff in ms; doubles each attempt (default 250 → 250/500/1000/…). */
  baseDelayMs?: number;
  /** Sleep hook — overridable so unit tests run without real timers. */
  sleepFn?: (ms: number) => Promise<void>;
  /** Called before each retry; defaults to a one-line console.warn breadcrumb. */
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
}

function defaultOnRetry(err: unknown, attempt: number, delayMs: number): void {
  console.warn(`[db] connection failed (${String(codeOf(err))}); retry ${attempt} in ${delayMs}ms`);
}

/**
 * Run `acquire`, retrying it only when it fails with a connection-acquisition
 * error (isRetryableConnectError). Any other error propagates on the first throw.
 * Callers MUST use this to obtain a connection, never to run SQL — that is what
 * keeps the retry write-safe. Exported for direct unit testing.
 */
export async function withConnectRetry<T>(acquire: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { retries = 5, baseDelayMs = 250, sleepFn = sleep, onRetry = defaultOnRetry } = options;
  for (let attempt = 0; ; attempt++) {
    try {
      return await acquire();
    } catch (err) {
      if (attempt >= retries || !isRetryableConnectError(err)) throw err;
      const delayMs = baseDelayMs * 2 ** attempt;
      onRetry(err, attempt + 1, delayMs);
      await sleepFn(delayMs);
    }
  }
}

/**
 * A pg.Pool whose connection attempts survive a briefly-unavailable Postgres.
 *
 * The Prisma pg adapter runs non-transactional queries through `pool.query` and
 * opens transactions through `pool.connect` (both on the external Pool it is
 * handed), so both routes to the DB acquire their connection through the
 * retrying `acquire`. `pool.query` is reimplemented as acquire→query→release —
 * a faithful mirror of pg-pool's own `query` (it releases the client with the
 * error on failure) — with only the acquisition retried (see the file header's
 * safety rule). We patch the instance rather than subclass so the object stays
 * `instanceof Pool`, which the adapter checks to treat this as an external pool
 * (and to keep its own idle-client `error` listener).
 */
export function createResilientPool(config: PoolConfig, options: RetryOptions = {}): Pool {
  // A hung connect (SYN sent, no reply) must fail fast INTO the retry instead of
  // blocking a request forever; a refused connect already rejects immediately.
  // Caller-supplied config wins if it sets its own timeout.
  const pool = new Pool({ connectionTimeoutMillis: 10_000, ...config });

  const origConnect = pool.connect.bind(pool) as (...args: unknown[]) => unknown;
  const origQuery = pool.query.bind(pool) as (...args: unknown[]) => unknown;

  const acquire = () => withConnectRetry(() => origConnect() as Promise<PoolClient>, options);

  // pool.connect: retry acquisition, then hand the client to the caller unchanged
  // (it owns release — e.g. the adapter's transaction path). Callback form passes
  // straight through.
  pool.connect = function patchedConnect(...args: unknown[]) {
    if (typeof args[0] === 'function') return origConnect(...args);
    return acquire();
  } as typeof pool.connect;

  // pool.query: acquire (with retry) then dispatch the SQL ONCE and release —
  // mirroring pg-pool's query semantics so nothing downstream sees a difference,
  // except that a connection blip during acquisition is now ridden out. Callback
  // form passes straight through (Prisma never uses it).
  pool.query = function patchedQuery(...args: unknown[]) {
    if (typeof args[args.length - 1] === 'function') return origQuery(...args);
    return (async () => {
      const client = await acquire();
      try {
        const result = await (client.query as (...a: unknown[]) => Promise<unknown>)(...args);
        client.release();
        return result;
      } catch (err) {
        client.release(err as Error); // pass the error so pg discards a broken connection
        throw err;
      }
    })();
  } as typeof pool.query;

  return pool;
}
