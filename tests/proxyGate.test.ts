/** @jest-environment node */
// The route gate (src/proxy.ts) WITH AUTH CONFIGURED — the posture no other test had.
//
// This is the configuration every machine-endpoint bug hides in. `requireRouteAuth`
// tests call the guard directly, the route tests import the handler (no proxy in the
// call path), and the e2e server runs auth-UNCONFIGURED, where the whole session gate
// compiles away to a no-op. So `POST /api/integrations/chat` — a route carrying its own
// admin-token credential — was 307-redirecting to /login in production against a valid
// token, and every suite was green (#157).
//
// Auth is mocked because next-auth v5 is ESM-only and won't compile under jest. The mock
// is a pass-through wrapper, which is faithful at the one boundary the proxy reads: real
// `auth(handler)` resolves the session and hands the handler a request carrying `.auth`.
// Here the test sets `.auth` itself, so "signed in" / "session-less" are exact.
jest.mock('server-only', () => ({}));
jest.mock('../src/auth', () => ({
  authConfigured: true,
  auth: (handler: unknown) => handler,
}));

import { readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';
import { sourceFiles, stripComments } from './helpers/sourceFiles';

const TOKEN = 'admin-token-abc';
const ORIGIN = 'https://autoknow.example.com';

type Gate = (req: NextRequest) => Promise<Response> | Response;
let proxy: Gate;

beforeAll(async () => {
  process.env.ADMIN_TOKEN = TOKEN;
  proxy = (await import('../src/proxy')).default as unknown as Gate;
});

afterAll(() => {
  delete process.env.ADMIN_TOKEN;
});

// The proxy's rate limiter is module-level and buckets by client IP + path class, so a
// test file that reused one IP would start 429ing partway through the ratchet loop below
// and assert nothing about the gate. One synthetic IP per request keeps every case
// independent.
let ip = 0;
const request = (
  path: string,
  { method = 'POST', session = null as unknown, headers = {} as Record<string, string> } = {},
): NextRequest => {
  const req = new NextRequest(`${ORIGIN}${path}`, {
    method,
    headers: { 'x-forwarded-for': `10.0.0.${(ip += 1)}`, ...headers },
  });
  // What real `auth()` injects; `undefined`/`null` is a session-less caller.
  Object.defineProperty(req, 'auth', { value: session, configurable: true });
  return req;
};

const sentToLogin = (res: Response): boolean =>
  res.status === 307 && (res.headers.get('location') ?? '').endsWith('/login');

describe('the session gate with auth configured', () => {
  it('redirects a session-less page request to /login', async () => {
    expect(sentToLogin(await proxy(request('/ecosystem', { method: 'GET' })))).toBe(true);
  });

  it('lets a signed-in request through', async () => {
    const res = await proxy(
      request('/ecosystem', { method: 'GET', session: { user: { email: 'dylan@alwaysmap.com' } } }),
    );
    expect(sentToLogin(res)).toBe(false);
    expect(res.status).toBe(200);
  });

  it('exempts the machine endpoints that carry their own credential', async () => {
    // Their credential is checked by the route (CRON_SECRET / Google's JWT), not here —
    // the gate's only job is to not redirect a caller that can never hold a session.
    expect(sentToLogin(await proxy(request('/api/cron/refresh', { method: 'GET' })))).toBe(false);
    expect(sentToLogin(await proxy(request('/api/chat/events')))).toBe(false);
    expect(sentToLogin(await proxy(request('/api/health', { method: 'GET' })))).toBe(false);
  });
});

describe('POST /api/integrations/chat through the gate (#157)', () => {
  const post = (headers: Record<string, string> = {}) =>
    proxy(request('/api/integrations/chat', { headers }));

  it('admits a session-less caller presenting a valid admin token', async () => {
    // The regression: this was a 307 to /login in prod, so the documented curl could
    // never reach the handler and the token value was irrelevant.
    const res = await post({ 'x-admin-token': TOKEN });
    expect(sentToLogin(res)).toBe(false);
    expect(res.status).toBe(200);
  });

  it('rejects a wrong token at the perimeter — 403, and the handler never runs', async () => {
    const res = await post({ 'x-admin-token': 'wrong' });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Forbidden' });
  });

  it('rejects any token when ADMIN_TOKEN is unset, rather than falling open', async () => {
    delete process.env.ADMIN_TOKEN;
    expect((await post({ 'x-admin-token': TOKEN })).status).toBe(403);
    process.env.ADMIN_TOKEN = TOKEN;
  });

  it('still redirects a credential-less caller — the exemption is not an open door', async () => {
    expect(sentToLogin(await post())).toBe(true);
  });

  it('still lets a signed-in browser through without a token', async () => {
    const res = await proxy(
      request('/api/integrations/chat', { session: { user: { email: 'dylan@alwaysmap.com' } } }),
    );
    expect(sentToLogin(res)).toBe(false);
  });

  it('rate-limits it like the other chat ingestion path, not like a plain mutation', async () => {
    // Same Gemini-backed work per message, so the same 60/min class; the default for a
    // POST would be 120. Shared IP on purpose — this case IS the limiter.
    const burst = { 'x-admin-token': TOKEN, 'x-forwarded-for': '10.9.9.9' };
    const codes: number[] = [];
    for (let i = 0; i < 62; i++) {
      codes.push((await proxy(request('/api/integrations/chat', { headers: burst }))).status);
    }
    expect(codes.slice(0, 60).every((c) => c === 200)).toBe(true);
    expect(codes[60]).toBe(429); // the first request OVER the limit is the boundary
    expect(codes[61]).toBe(429);
  });
});

// ---------------------------------------------------------------------------------
// The ratchet: every route that accepts a machine credential is either reachable by a
// machine through the gate, or explicitly declared session-only here. #157 was the third
// machine endpoint and the first to get this wrong, and nothing in the tree connected a
// route's credential to the perimeter that decides whether the credential is ever read.
//
// Classification is behavioral, not textual: each route is PUT THROUGH the real proxy
// carrying an admin token and no session. A source scan of the exemption list would drift
// from what the list actually does.
// ---------------------------------------------------------------------------------

const API_ROOT = 'src/app/api';

/** Routes whose machine credential is deliberately unreachable from outside: they are
 *  browser mutations that `requireRouteAuth` happens to also admit a token for, and the
 *  session gate in front of them is the intended perimeter. Adding a route here is a
 *  claim the test verifies (it must actually be redirected). */
const SESSION_ONLY = [
  '/api/partners',
  '/api/people',
  '/api/people/[id]/affiliations',
  '/api/people/[id]/affiliations/[affiliationId]',
  '/api/projects',
  '/api/projects/[id]/needle',
  '/api/projects/[id]/phases',
  '/api/projects/[id]/phases/[phaseId]/action-items',
  '/api/projects/[id]/phases/[phaseId]/state',
  '/api/summaries/[scope]/[id]',
];

/** A route accepts a machine credential if its code reads one. Comments are stripped: a
 *  comment ABOUT the admin token is not a check of it. */
const ACCEPTS_MACHINE_CREDENTIAL = /requireRouteAuth|x-admin-token|CRON_SECRET|verifyChatToken/;

const routeUrl = (file: string): string =>
  '/' + file.replace(/^src\/app\//, '').replace(/\/route\.tsx?$/, '');

/** Walked once: the set depends on the source tree, which no test here changes. */
const MACHINE_ROUTES: string[] = sourceFiles(API_ROOT)
  .filter((f) => /\/route\.tsx?$/.test(f))
  .filter((f) => ACCEPTS_MACHINE_CREDENTIAL.test(stripComments(readFileSync(f, 'utf8'))))
  .map(routeUrl)
  .sort();

/** Does a machine caller — valid admin token, no session — reach the handler? */
const reachableByMachine = async (url: string): Promise<boolean> => {
  // Dynamic segments get any placeholder — the gate matches on path prefix, never on the value.
  const path = url.replace(/\[[^\]]+\]/g, 'x');
  const res = await proxy(request(path, { headers: { 'x-admin-token': TOKEN } }));
  return !sentToLogin(res);
};

describe('machine-credentialed routes are declared at the perimeter', () => {
  it('has no route that accepts a credential the gate never lets it read', async () => {
    const undeclared: string[] = [];
    for (const url of MACHINE_ROUTES) {
      if (SESSION_ONLY.includes(url)) continue;
      if (!(await reachableByMachine(url))) undeclared.push(url);
    }
    expect(undeclared).toEqual([]);
  });

  it('holds every session-only declaration to its word', async () => {
    const stale = SESSION_ONLY.filter((url) => !MACHINE_ROUTES.includes(url));
    expect(stale).toEqual([]);
    const mislabeled: string[] = [];
    for (const url of SESSION_ONLY) {
      if (await reachableByMachine(url)) mislabeled.push(url);
    }
    expect(mislabeled).toEqual([]);
  });

  it('the scan finds the real machine endpoints — not an empty set (anti-vacuity)', () => {
    // Without this, a broken walker, a moved API root or a renamed guard would leave the
    // ratchet above passing over zero routes forever.
    expect(MACHINE_ROUTES).toEqual(
      expect.arrayContaining([
        '/api/chat/events',
        '/api/cron/refresh',
        '/api/integrations/chat',
        '/api/partners',
      ]),
    );
    expect(MACHINE_ROUTES.length).toBeGreaterThan(5);
  });

  it('the probe can say NO — an unexempted path is not reachable (anti-vacuity)', async () => {
    // The other half: a probe that answered "reachable" for everything would make the
    // ratchet unfalsifiable. A path on no branch of the gate must come back redirected.
    expect(await reachableByMachine('/api/not-exempt-anywhere')).toBe(false);
  });
});
