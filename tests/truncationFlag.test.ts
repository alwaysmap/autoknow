/** @jest-environment node */
// A source longer than MAX_DOC_CHARS is LOSSY and says so (#56, the scaling ADR's decisions
// 3 + 4): one source = one digest = one embedding, so everything past the 30K distillation
// cap never reached the model and cannot be searched. The flag is written at ingest,
// re-evaluated on every refresh, and counted for Manage → Sources — a limit the user can
// see on the row it applies to, rather than a search result that is quietly incomplete.
import { testDatabaseUrl } from './helpers/testDatabaseUrl';
import { prisma, disconnectTestDb } from './helpers/db';
import { wipeAll } from './helpers/fixtures';

process.env.DATABASE_URL = testDatabaseUrl();

jest.mock('server-only', () => ({}));

// Real ingests against the test database (digest + embedding + revision, all on their
// no-key deterministic path) — slower than the 5s default, nowhere near a hang.
jest.setTimeout(30_000);

// EVERY src import here is dynamic, including the constant: a static one is hoisted above
// the env assignments above, and next/jest has already loaded the real .env — so a hoisted
// `import { MAX_DOC_CHARS } from '../src/lib/gemini'` binds gemini.ts to the developer's
// live API key and the "deterministic fallback" turns into real network calls (it did).
let MAX_DOC_CHARS: number;
let ingestContent: typeof import('../src/lib/ingest').ingestContent;
let refreshSource: typeof import('../src/lib/refresh').refreshSource;
let getIngestionHealth: typeof import('../src/lib/ingestionHealth').getIngestionHealth;

const body = (chars: number) => 'Audio HAL bring-up notes. '.repeat(Math.ceil(chars / 26)).slice(0, chars);

const ingest = (sourceRef: string, chars: number) =>
  ingestContent({
    url: `https://example.com/${sourceRef}`,
    title: sourceRef,
    text: body(chars),
    source: { kind: 'web', mode: 'watched', sourceRef },
    mode: 'watched',
    modeSource: 'inferred',
  });

const rowOf = (sourceRef: string) =>
  prisma.contextUrl.findUniqueOrThrow({ where: { sourceRef }, select: { id: true, truncated: true } });

beforeAll(async () => {
  ({ MAX_DOC_CHARS } = await import('../src/lib/gemini'));
  ({ ingestContent } = await import('../src/lib/ingest'));
  ({ refreshSource } = await import('../src/lib/refresh'));
  ({ getIngestionHealth } = await import('../src/lib/ingestionHealth'));
  await wipeAll();
});

afterAll(async () => {
  await disconnectTestDb();
});

describe('lossy sources are flagged at the 30K distillation cap', () => {
  it('flags a source whose text ran past the cap, and leaves a short one alone', async () => {
    await ingest('short', 500);
    await ingest('long', MAX_DOC_CHARS + 1);

    expect((await rowOf('short')).truncated).toBe(false);
    expect((await rowOf('long')).truncated).toBe(true);
  });

  it('re-evaluates the flag when the source changes', async () => {
    await ingest('grows', 500);
    const { id } = await rowOf('grows');
    expect((await rowOf('grows')).truncated).toBe(false);

    // The refresh path re-reads the source; stub the fetch to serve a much longer document
    // than the one that was ingested.
    const realFetch = global.fetch;
    global.fetch = jest.fn(async () =>
      new Response(body(MAX_DOC_CHARS + 5000), { status: 200, headers: { 'content-type': 'text/plain' } }),
    ) as typeof fetch;
    try {
      const outcome = await refreshSource(id);
      expect(outcome.result).toBe('changed');
    } finally {
      global.fetch = realFetch;
    }

    expect((await rowOf('grows')).truncated).toBe(true);
  });

  it('counts the lossy rows for the ingestion-health panel', async () => {
    const health = await getIngestionHealth();
    expect(health.truncated).toBe(await prisma.contextUrl.count({ where: { truncated: true } }));
    expect(health.truncated).toBeGreaterThan(0);
  });
});
