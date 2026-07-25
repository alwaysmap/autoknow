/** @jest-environment node */
// The seed-only mock connector in lib/refresh: the branch that lets a seeded corpus
// source be re-fetched from lib/mockCorpus instead of the network, so re-ingestion can
// be exercised end to end in a demo.
//
// The first suite is the one that matters. Fixture prose reaching a real deployment
// would be distilled, embedded, cited in AI briefings and shown in the activity feed as
// ingested fact — AGENTS lesson 5, and the exact shape of the fabricated-panel incident
// that tests/noFabricatedData.test.ts exists for. So the connector ships with its guard
// (lesson 2), and this is the guard's test.
import { testDatabaseUrl } from './helpers/testDatabaseUrl';
import { prisma, disconnectTestDb } from './helpers/db';
import { wipeAll } from './helpers/fixtures';
import { MOCK_CORPUS, mockSourceRef, mockVersion } from '../src/lib/mockCorpus';

process.env.DATABASE_URL = testDatabaseUrl();

jest.mock('server-only', () => ({}));

// The digest is the model's job; this suite is about which TEXT the connector serves and
// what it writes, so the model is stubbed to something inspectable.
jest.mock('../src/lib/gemini', () => ({
  summarizeDocument: jest.fn(async (text: string, previous?: string) => ({
    summary: `digest of ${text.slice(0, 24)}`,
    keyTopics: [],
    decisions: [],
    openQuestions: [],
    entities: { partners: [], programs: [], people: [] },
    // A bug whose newest revision reads as fixed must freeze the row.
    sourceStatus: /Status: Fixed|RESOLVED/.test(text) ? 'resolved' : 'open',
    delta: previous ? 'something changed' : undefined,
  })),
  digestToText: (d: { summary: string }) => d.summary,
  embedText: jest.fn(async () => Array(768).fill(0)),
  isQuotaError: () => false,
}));

let refreshSource: typeof import('../src/lib/refresh').refreshSource;

beforeAll(async () => {
  ({ refreshSource } = await import('../src/lib/refresh'));
});

beforeEach(async () => {
  await wipeAll();
});

afterAll(async () => {
  await disconnectTestDb();
});

/** A corpus entry with more than one authored revision — there is something to fetch. */
const MULTI = MOCK_CORPUS.find((s) => s.revisions.length > 1)!;

async function seedMockRow(entry = MULTI, versionIndex = 0) {
  return prisma.contextUrl.create({
    data: {
      url: entry.url,
      type: 'Doc',
      mode: 'watched',
      sourceRef: mockSourceRef(entry.key),
      sourceVersion: mockVersion(versionIndex),
      ingestedText: 'the previous digest',
      contentHash: 'a-hash-that-will-not-match',
    },
  });
}

describe('the mock connector is refused outside a disposable database', () => {
  it('refuses to serve fixture content when the database is not demo/test', async () => {
    const row = await seedMockRow();

    // destructiveDbAllowed() reads DATABASE_URL at call time. Point it at a name that is
    // neither *_test nor named in DESTRUCTIVE_DB_ALLOWED — i.e. what production looks
    // like — for the duration of this one call.
    const realUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgresql://u:p@localhost:5432/autoknow_prod';
    let outcome;
    try {
      outcome = await refreshSource(row.id);
    } finally {
      process.env.DATABASE_URL = realUrl;
    }

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/demo\/test database/);

    // And nothing was written: no revision, no digest, no freeze.
    const after = await prisma.contextUrl.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.ingestedText).toBe('the previous digest');
    expect(await prisma.contextRevision.count({ where: { contextUrlId: row.id } })).toBe(0);
  });
});

describe('the mock connector serves authored revisions', () => {
  it('serves the NEXT revision, appends history, and advances the version cursor', async () => {
    const row = await seedMockRow(MULTI, 0);

    const outcome = await refreshSource(row.id);
    expect(outcome.ok).toBe(true);
    expect(outcome.result).toBe('changed');

    const after = await prisma.contextUrl.findUniqueOrThrow({ where: { id: row.id } });
    // The cursor moved to v1, which is what makes the NEXT refresh serve v2 (or stop).
    expect(after.sourceVersion).toBe(mockVersion(1));
    expect(after.ingestedText).toBe(`digest of ${MULTI.revisions[1].text.slice(0, 24)}`);
    // A real re-distillation appends real history — this is what the activity feed's
    // "Updated: …" card reads.
    const revisions = await prisma.contextRevision.findMany({ where: { contextUrlId: row.id } });
    expect(revisions).toHaveLength(1);
    expect(revisions[0].delta).toBe('something changed');
  });

  it('reports unchanged once the fixture has nothing newer', async () => {
    // Park the cursor on the last authored revision.
    const row = await seedMockRow(MULTI, MULTI.revisions.length - 1);

    const outcome = await refreshSource(row.id);

    expect(outcome.ok).toBe(true);
    expect(outcome.result).toBe('unchanged');
    // Gate 1 short-circuits before any model call, so an exhausted fixture is free —
    // which is what makes leaving the demo ticker running indefinitely safe.
    expect(await prisma.contextRevision.count({ where: { contextUrlId: row.id } })).toBe(0);
    const after = await prisma.contextUrl.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.lastCheckedAt).not.toBeNull();
  });

  it('freezes a source whose newest revision reads as resolved', async () => {
    // The bug that ends "Status: Fixed (merged)" — the freshness lifecycle running to
    // completion on seeded data, which is the thing the demo is meant to show.
    const bug = MOCK_CORPUS.find((s) => /Status: Fixed|RESOLVED/.test(s.revisions.at(-1)!.text))!;
    const row = await seedMockRow(bug, bug.revisions.length - 2);

    const outcome = await refreshSource(row.id);

    expect(outcome.ok).toBe(true);
    expect(outcome.result).toBe('frozen');
    expect(outcome.frozenReason).toBe('resolved');
    const after = await prisma.contextUrl.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.frozenAt).not.toBeNull();
  });
});

describe('the corpus itself', () => {
  it('has unique keys, since the key IS the dedupe identity', async () => {
    const keys = MOCK_CORPUS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('orders every source’s revisions oldest-first', async () => {
    // daysAgo must DECREASE along the array: the connector serves them in index order
    // and the seed dates the row from index 0, so an out-of-order entry would produce a
    // source whose history runs backwards.
    for (const s of MOCK_CORPUS) {
      const days = s.revisions.map((r) => r.daysAgo);
      expect(days).toEqual([...days].sort((a, b) => b - a));
    }
  });
});
