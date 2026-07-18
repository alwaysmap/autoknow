/** @jest-environment node */
// Regression suite for the cron refresh worker's failure isolation: one broken
// source must not abort the cycle, and a failing source must rotate to the back of
// the lastCheckedAt queue instead of pinning the head and starving the others.
import { testDatabaseUrl } from './helpers/testDatabaseUrl';
import { prisma, disconnectTestDb } from './helpers/db';

process.env.DATABASE_URL = testDatabaseUrl();

jest.mock('server-only', () => ({}));

jest.mock('../src/lib/gemini', () => ({
  summarizeDocument: jest.fn(async (text: string) => {
    if (text.includes('BOOM')) throw new Error('model exploded');
    return {
      summary: `digest of ${text}`,
      keyTopics: [],
      decisions: [],
      openQuestions: [],
      entities: { partners: [], programs: [], people: [] },
      sourceStatus: 'not-applicable',
    };
  }),
  digestToText: (d: { summary: string }) => d.summary,
  embedText: jest.fn(async () => Array(768).fill(0)),
}));

jest.mock('../src/lib/ingest', () => {
  const actual = jest.requireActual('../src/lib/ingest');
  return {
    ...actual,
    fetchWebUrl: jest.fn(async (url: string) => ({
      ok: true,
      notModified: false,
      authWall: false,
      text: url.includes('bad') ? 'BOOM content' : 'good content',
      etag: null,
    })),
  };
});

let runRefreshCycle: typeof import('../src/lib/refresh').runRefreshCycle;

beforeAll(async () => {
  ({ runRefreshCycle } = await import('../src/lib/refresh'));
});

beforeEach(async () => {
  await prisma.contextRevision.deleteMany();
  await prisma.contextUrl.deleteMany();
});

afterAll(async () => {
  await disconnectTestDb();
});

async function seedWatched(url: string) {
  return prisma.contextUrl.create({
    data: { url, type: 'Doc', mode: 'watched', sourceRef: url },
  });
}

describe('runRefreshCycle failure isolation', () => {
  it('a throwing source is counted as an error and does not abort the cycle', async () => {
    const bad = await seedWatched('http://example.com/bad');
    const good = await seedWatched('http://example.com/good');

    const report = await runRefreshCycle();

    expect(report.checked).toBe(2);
    expect(report.errors).toBe(1);
    expect(report.changed).toBe(1);

    // The healthy source completed its full re-distillation.
    const refreshed = await prisma.contextUrl.findUniqueOrThrow({ where: { id: good.id } });
    expect(refreshed.ingestedText).toBe('digest of good content');
    expect(refreshed.contentHash).not.toBeNull();
    expect(await prisma.contextRevision.count({ where: { contextUrlId: good.id } })).toBe(1);

    // The broken source stays un-digested but is not silently forgotten.
    const broken = await prisma.contextUrl.findUniqueOrThrow({ where: { id: bad.id } });
    expect(broken.ingestedText).toBeNull();
  });

  it('a failing source rotates to the back of the lastCheckedAt queue', async () => {
    const bad = await seedWatched('http://example.com/bad');
    await runRefreshCycle();

    const broken = await prisma.contextUrl.findUniqueOrThrow({ where: { id: bad.id } });
    // Without this, orderBy lastCheckedAt asc re-selects the same failing source
    // every cycle until MAX_REFRESHES_PER_CYCLE failures block the whole queue.
    expect(broken.lastCheckedAt).not.toBeNull();
  });
});
