/** @jest-environment node */
// The connect-retry that hardens the CI DB connection (src/lib/pgPool.ts). These
// prove the mechanism deterministically, without a database: a transient
// connection-acquisition failure is retried and recovers, while a query-execution
// error (a Postgres SQLSTATE) propagates untouched. The retry is only ever wrapped
// around acquisition, so recovering from a connection reset never re-runs a write.

import { isRetryableConnectError, withConnectRetry } from '../src/lib/pgPool';

const connErr = (code: string) => Object.assign(new Error(code), { code });
const noSleep = async () => {};

describe('isRetryableConnectError', () => {
  it('classifies connection-acquisition codes as retryable', () => {
    // ECONNRESET is included: because retry only wraps acquisition (never the SQL),
    // a reset during the server's startup handshake is safe to retry.
    for (const code of ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', '57P03']) {
      expect(isRetryableConnectError(connErr(code))).toBe(true);
    }
  });

  it('does NOT retry a query-execution error or a non-coded error', () => {
    // 42P01 (undefined_table) is a Postgres SQLSTATE from running SQL, not a
    // connection failure — retrying it would be pointless and wrong.
    expect(isRetryableConnectError(connErr('42P01'))).toBe(false);
    expect(isRetryableConnectError(new Error('boom'))).toBe(false);
    expect(isRetryableConnectError(null)).toBe(false);
  });
});

describe('withConnectRetry', () => {
  it('retries a briefly-unavailable DB and then succeeds', async () => {
    let attempts = 0;
    const retried: number[] = [];
    const result = await withConnectRetry(
      async () => {
        attempts += 1;
        if (attempts < 3) throw connErr('ECONNREFUSED'); // blips twice, then recovers
        return 'ok';
      },
      { baseDelayMs: 10, sleepFn: noSleep, onRetry: (_e, n) => retried.push(n) },
    );
    expect(result).toBe('ok');
    expect(attempts).toBe(3);
    expect(retried).toEqual([1, 2]); // two retries announced
  });

  it('propagates a non-retryable error on the first throw (no retry)', async () => {
    let attempts = 0;
    await expect(
      withConnectRetry(
        async () => {
          attempts += 1;
          throw connErr('42P01'); // a real query error, not a connection blip
        },
        { sleepFn: noSleep, onRetry: () => {} },
      ),
    ).rejects.toMatchObject({ code: '42P01' });
    expect(attempts).toBe(1); // tried exactly once
  });

  it('gives up after the configured retries and throws the last error', async () => {
    let attempts = 0;
    await expect(
      withConnectRetry(
        async () => {
          attempts += 1;
          throw connErr('ECONNREFUSED'); // never recovers
        },
        { retries: 3, baseDelayMs: 1, sleepFn: noSleep, onRetry: () => {} },
      ),
    ).rejects.toMatchObject({ code: 'ECONNREFUSED' });
    expect(attempts).toBe(4); // 1 initial + 3 retries
  });
});
