/** @jest-environment node */
// The per-route auth guard must fail closed: with auth configured it admits only a
// session or a valid admin token; with auth *mis*configured (off in production) it
// denies everything token-less — that misconfiguration is exactly why it exists.
jest.mock('server-only', () => ({}));

const mockState: { configured: boolean; session: { user?: { email?: string } } | null } = {
  configured: true,
  session: null,
};
jest.mock('../src/auth', () => ({
  get authConfigured() {
    return mockState.configured;
  },
  auth: jest.fn(async () => mockState.session),
}));

import { requireRouteAuth } from '../src/lib/routeAuth';

const TOKEN = 'admin-token-abc';
const req = (headers: Record<string, string> = {}) =>
  new Request('http://localhost/api/partners', { method: 'POST', headers });

const originalNodeEnv = process.env.NODE_ENV;
afterEach(() => {
  (process.env as Record<string, string | undefined>).NODE_ENV = originalNodeEnv;
  delete process.env.ADMIN_TOKEN;
});

describe('requireRouteAuth with auth configured', () => {
  beforeEach(() => {
    mockState.configured = true;
  });

  it('admits a signed-in session', async () => {
    mockState.session = { user: { email: 'dylan@example.com' } };
    expect(await requireRouteAuth(req())).toBe(true);
  });

  it('denies a session-less request', async () => {
    mockState.session = null;
    expect(await requireRouteAuth(req())).toBe(false);
  });

  it('admits a valid admin token without a session', async () => {
    mockState.session = null;
    process.env.ADMIN_TOKEN = TOKEN;
    expect(await requireRouteAuth(req({ 'x-admin-token': TOKEN }))).toBe(true);
    expect(await requireRouteAuth(req({ 'x-admin-token': 'wrong' }))).toBe(false);
  });

  it('denies when no token is configured, even outside production', async () => {
    mockState.session = null;
    // adminOperationsAllowed's dev fallback must NOT admit session-less requests here
    expect(await requireRouteAuth(req({ 'x-admin-token': 'anything' }))).toBe(false);
  });
});

describe('requireRouteAuth with auth unconfigured', () => {
  beforeEach(() => {
    mockState.configured = false;
    mockState.session = null;
  });

  it('admits everything outside production (CI / tests / fresh checkout)', async () => {
    expect(await requireRouteAuth(req())).toBe(true);
  });

  it('fails closed in production: token-less requests are denied', async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    expect(await requireRouteAuth(req())).toBe(false);
  });

  it('still admits a valid admin token in production', async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    process.env.ADMIN_TOKEN = TOKEN;
    expect(await requireRouteAuth(req({ 'x-admin-token': TOKEN }))).toBe(true);
  });
});
