/** @jest-environment node */
// The cron refresh worker, against the real *_test database. Two suites:
//   1. failure isolation — one broken source must not abort the cycle, and a failing
//      source must rotate to the back of the lastCheckedAt queue instead of pinning the
//      head and starving the others.
//   2. due-source selection (#58) — which rows Postgres returns, in what order, and how
//      many. The source-text ratchet that guards the same predicate lives next door in
//      tests/cadenceClassesExpressibleInSql.test.ts, which needs no database.
import { testDatabaseUrl } from './helpers/testDatabaseUrl';
import { prisma, disconnectTestDb } from './helpers/db';
import { wipeAll } from './helpers/fixtures';

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
  isQuotaError: () => false, // the test's 'model exploded' is a plain error, not a 429
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
  // wipeAll, not a two-table deleteMany: the due-source tests below assert ABSOLUTE
  // counts, so any row another suite leaves behind is a failure here. Hand-rolling the
  // wipe is what cost driveSync.test.ts its FK-safe ordering once already (AGENTS
  // lesson 9); this suite was the last one still doing it.
  await wipeAll();
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

    // Explicit budget keeps this a pure failure-isolation test — no coupling to the
    // stored IngestionSettings (that derivation is covered by tests/ingestBudget.test.ts).
    const report = await runRefreshCycle({ maxRefreshes: 10 });

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
    await runRefreshCycle({ maxRefreshes: 10 });

    const broken = await prisma.contextUrl.findUniqueOrThrow({ where: { id: bad.id } });
    // Without this, orderBy lastCheckedAt asc re-selects the same failing source
    // every cycle until MAX_REFRESHES_PER_CYCLE failures block the whole queue.
    expect(broken.lastCheckedAt).not.toBeNull();
  });
});

// ---- Due-source selection, now done by Postgres (#58) --------------------------------
//
// The cycle used to read every watched row into memory and filter in JS. It now selects
// with an indexed `WHERE … ORDER BY … LIMIT`, which moves three decisions into SQL that
// were previously obvious in TypeScript: which rows are due, in what order, and how many
// come back. These tests pin all three — a selection bug here is silent (sources simply
// stop being refreshed) and no other test would notice.
//
// The cadence class is read from `type`, not re-derived from the URL: 'Gerrit' is the
// value ingest records for kind 'tracker' (LEGACY_TYPE_BY_KIND), and everything else
// takes the slow web cadence.

const HOUR = 3600_000;

async function seedChecked(url: string, type: string, hoursAgo: number, sourceRef = url) {
  return prisma.contextUrl.create({
    data: {
      url, type, mode: 'watched', sourceRef,
      lastCheckedAt: new Date(Date.now() - hoursAgo * HOUR),
    },
  });
}

describe('runRefreshCycle due-source selection', () => {
  it('honours the per-kind cadence: at 8h a tracker is due and a web page is not', async () => {
    await seedChecked('http://example.com/tracker-good', 'Gerrit', 8);
    await seedChecked('http://example.com/web-good', 'Doc', 8);

    const report = await runRefreshCycle({ maxRefreshes: 10 });

    // 8h: past the tracker's 6h cadence, nowhere near the web page's 168h.
    expect(report.due).toBe(1);
    expect(report.checked).toBe(1);
    const web = await prisma.contextUrl.findFirstOrThrow({
      where: { url: 'http://example.com/web-good' },
    });
    expect(web.ingestedText).toBeNull(); // never fetched
  });

  it('a web page IS due once past its own 168h cadence', async () => {
    await seedChecked('http://example.com/web-good', 'Doc', 24 * 8);
    const report = await runRefreshCycle({ maxRefreshes: 10 });
    expect(report.due).toBe(1);
    expect(report.checked).toBe(1);
  });

  it('a never-checked source is due — a null lastCheckedAt is not "checked just now"', async () => {
    await seedWatched('http://example.com/good'); // lastCheckedAt null
    const report = await runRefreshCycle({ maxRefreshes: 10 });
    expect(report.due).toBe(1);
    expect(report.checked).toBe(1);
  });

  it('takes the OLDEST due sources first, and only as many as the budget', async () => {
    // Insertion order is deliberately oldest, NEWEST, middle — so the expected pair
    // {oldest, middle} is neither the first two rows nor the last two. An earlier version
    // of this test seeded newest-first and passed even with the ORDER BY replaced by
    // `id: 'desc'`, because reversed-insertion happened to give the same two rows: the
    // assertion was real but the fixture could not tell the orderings apart.
    await seedChecked('http://example.com/good-oldest', 'Gerrit', 500);
    await seedChecked('http://example.com/good-newest', 'Gerrit', 7);
    await seedChecked('http://example.com/good-middle', 'Gerrit', 50);

    const report = await runRefreshCycle({ maxRefreshes: 2 });

    expect(report.due).toBe(3); // the COUNT still sees all of them…
    expect(report.checked).toBe(2); // …but only the budget's worth came back
    expect(report.backlog).toBe(1);

    const digested = await prisma.contextUrl.findMany({
      where: { ingestedText: { not: null } },
      select: { url: true },
    });
    expect(digested.map((d) => d.url).sort()).toEqual([
      'http://example.com/good-middle',
      'http://example.com/good-oldest',
    ]);
  });

  it('leaves drive: rows to the Drive sweep, and reports them as skipped rather than dropping them', async () => {
    // The web fetcher has no service-account token, so a drive row reaching this cycle
    // would fail every hour forever. It must be excluded AND still be visible in the report.
    await seedChecked('https://docs.google.com/document/d/abc/edit', 'Doc', 500, 'drive:abc');
    await seedChecked('http://example.com/good', 'Gerrit', 500);

    const report = await runRefreshCycle({ maxRefreshes: 10 });

    expect(report.skippedDrive).toBe(1);
    expect(report.due).toBe(1);
    expect(report.checked).toBe(1);
  });

  it('includes a watched row with a NULL sourceRef', async () => {
    // Regression guard for the SQL rewrite: `NOT (sourceRef LIKE 'drive:%')` evaluates to
    // NULL — and so excludes the row — when sourceRef is null, where the old JS filter
    // (`c.sourceRef?.startsWith(…)`) included it. The predicate spells the null case out.
    await prisma.contextUrl.create({
      data: { url: 'http://example.com/good', type: 'Doc', mode: 'watched', sourceRef: null },
    });
    const report = await runRefreshCycle({ maxRefreshes: 10 });
    expect(report.due).toBe(1);
    expect(report.checked).toBe(1);
  });

  it('ignores snapshot and frozen rows', async () => {
    await prisma.contextUrl.create({
      data: { url: 'http://example.com/good-snap', type: 'Gerrit', mode: 'snapshot', sourceRef: 'snap' },
    });
    await prisma.contextUrl.create({
      data: {
        url: 'http://example.com/good-frozen', type: 'Gerrit', mode: 'watched', sourceRef: 'frozen',
        frozenAt: new Date(), frozenReason: 'resolved',
      },
    });
    const report = await runRefreshCycle({ maxRefreshes: 10 });
    expect(report.due).toBe(0);
    expect(report.checked).toBe(0);
  });
});

