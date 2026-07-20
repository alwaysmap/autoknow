/** @jest-environment node */
import { testDatabaseUrl } from './helpers/testDatabaseUrl';
process.env.DATABASE_URL = testDatabaseUrl(); // bind lib/db to the *_test database

import { disconnectTestDb } from './helpers/db';

// Dynamic import AFTER the env assignment above — a static import is hoisted and
// would evaluate src/lib/db (binding its prisma client) before DATABASE_URL is set.
type HealthRoute = typeof import('../src/app/api/health/route');
let GET: HealthRoute['GET'];

// /api/health is the public probe uptime checks and deploy smoke tests hit: it
// must report the running build and database reachability, and never a secret.
describe('GET /api/health', () => {
  beforeAll(async () => {
    ({ GET } = await import('../src/app/api/health/route'));
  });

  afterAll(async () => {
    await disconnectTestDb();
  });

  it('returns ok with a build sha and db status', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, sha: expect.any(String), db: 'ok' });
  });
});
