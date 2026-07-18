/** @jest-environment node */
// The cron secret is long-lived and high-value: it must never ride in a query
// string (query strings land in Funnel/relay/access logs), and comparisons must be
// constant-time.
jest.mock('server-only', () => ({}));
jest.mock('../src/lib/refresh', () => ({
  runRefreshCycle: jest.fn(async () => ({ due: 0, checked: 0, changed: 0, frozen: 0, errors: 0, skippedDrive: 0 })),
}));
jest.mock('../src/lib/driveSync', () => ({ runDriveSync: jest.fn(async () => ({ ok: true })) }));
jest.mock('../src/lib/summaries', () => ({ runSummaryCycle: jest.fn(async () => ({ generated: 0 })) }));

import { NextRequest } from 'next/server';
import { secretsEqual } from '../src/lib/api';

const SECRET = 'test-secret-123';
let GET: typeof import('../src/app/api/cron/refresh/route').GET;

beforeAll(async () => {
  process.env.CRON_SECRET = SECRET;
  ({ GET } = await import('../src/app/api/cron/refresh/route'));
});

describe('GET /api/cron/refresh auth', () => {
  it('accepts the secret as a bearer token', async () => {
    const res = await GET(
      new NextRequest('http://localhost/api/cron/refresh', {
        headers: { authorization: `Bearer ${SECRET}` },
      }),
    );
    expect(res.status).toBe(200);
  });

  it('rejects the secret in the query string — it would leak into access logs', async () => {
    const res = await GET(new NextRequest(`http://localhost/api/cron/refresh?secret=${SECRET}`));
    expect(res.status).toBe(401);
  });

  it('rejects a wrong or missing bearer token', async () => {
    const wrong = await GET(
      new NextRequest('http://localhost/api/cron/refresh', {
        headers: { authorization: 'Bearer nope' },
      }),
    );
    expect(wrong.status).toBe(401);
    const missing = await GET(new NextRequest('http://localhost/api/cron/refresh'));
    expect(missing.status).toBe(401);
  });
});

describe('secretsEqual', () => {
  it('matches equal strings and rejects everything else', () => {
    expect(secretsEqual('abc', 'abc')).toBe(true);
    expect(secretsEqual('abd', 'abc')).toBe(false);
    expect(secretsEqual('abcdef', 'abc')).toBe(false); // length mismatch must not throw
    expect(secretsEqual('', 'abc')).toBe(false);
    expect(secretsEqual(null, 'abc')).toBe(false);
    expect(secretsEqual(undefined, 'abc')).toBe(false);
  });
});
