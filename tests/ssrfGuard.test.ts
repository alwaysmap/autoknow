/** @jest-environment node */
// DNS-rebinding guard: a hostname whose A record points inside the network must be
// rejected even though the hostname string looks innocent — before the fetch, and
// again on every redirect hop.
import { testDatabaseUrl } from './helpers/testDatabaseUrl';

process.env.DATABASE_URL = testDatabaseUrl();

jest.mock('server-only', () => ({}));
jest.mock('node:dns/promises', () => ({
  lookup: jest.fn(async (host: string) => {
    if (host === 'rebind.example') return [{ address: '169.254.169.254', family: 4 }];
    if (host === 'internal-cname.example') return [{ address: '10.1.2.3', family: 4 }];
    if (host === 'unresolvable.example') throw new Error('ENOTFOUND');
    return [{ address: '93.184.216.34', family: 4 }];
  }),
}));

const realFetch = global.fetch;
let fetchWebUrl: typeof import('../src/lib/ingest').fetchWebUrl;

beforeAll(async () => {
  ({ fetchWebUrl } = await import('../src/lib/ingest'));
});

afterEach(() => {
  global.fetch = realFetch;
});

it('rejects a hostname resolving to the metadata range', async () => {
  global.fetch = jest.fn(async () => {
    throw new Error('fetch must never be called for a forbidden host');
  }) as typeof fetch;
  const res = await fetchWebUrl('http://rebind.example/doc');
  expect(res.ok).toBe(false);
  expect(res.error).toMatch(/not fetchable/);
});

it('rejects an unresolvable hostname', async () => {
  const res = await fetchWebUrl('http://unresolvable.example/doc');
  expect(res.ok).toBe(false);
});

it('re-validates every redirect hop', async () => {
  global.fetch = jest.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.startsWith('http://public.example/')) {
      return new Response(null, { status: 302, headers: { location: 'http://internal-cname.example/secret' } });
    }
    throw new Error(`unexpected fetch of ${url}`);
  }) as typeof fetch;
  const res = await fetchWebUrl('http://public.example/doc');
  expect(res.ok).toBe(false);
  expect(res.error).toMatch(/redirects somewhere not fetchable/);
});

it('still fetches a healthy public page', async () => {
  global.fetch = jest.fn(async () =>
    new Response('<html><title>Hello</title><body>real content here</body></html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    }),
  ) as typeof fetch;
  const res = await fetchWebUrl('http://public.example/doc');
  expect(res.ok).toBe(true);
  expect(res.title).toBe('Hello');
});
