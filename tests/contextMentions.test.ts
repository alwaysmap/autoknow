/** @jest-environment node */
// #177 — extracted people reach the database and stay honest there:
//   - ingestContent persists mentions inside the row's own transaction and stamps
//     `mentionsExtractedAt` (a REAL model ran) — the keyless contract is pinned in
//     tests/seedMock.test.ts, which seeds without a key and asserts the marker stays null.
//   - refreshSource REWRITES mentions on every real re-distillation (the entities are
//     not serialized into digest text, so an unchanged digest string can still carry a
//     changed people list).
//   - the backfill re-resolves unresolved mentions for free, extracts over stored
//     digests for unmarked rows, and is idempotent.
import { testDatabaseUrl } from './helpers/testDatabaseUrl';
import { prisma, disconnectTestDb } from './helpers/db';
import { wipeAll } from './helpers/fixtures';
import { MOCK_CORPUS, mockSourceRef, mockVersion } from '../src/lib/mockCorpus';

process.env.DATABASE_URL = testDatabaseUrl();

jest.mock('server-only', () => ({}));

const summarizeDocument = jest.fn();
const embedForStorage = jest.fn(async () => Array(768).fill(0));
const extractDigestEntities = jest.fn();

// Only the provider calls are faked; the resolution machinery under test is real.
// `geminiConfigured: true` because mention persistence is gated on a real model being
// present — the un-mocked module would report false (tests/no-live-gemini deletes the
// key) and this suite would silently assert the keyless no-op.
jest.mock('../src/lib/gemini', () => {
  const actual = jest.requireActual('../src/lib/gemini');
  return {
    ...actual,
    geminiConfigured: true,
    summarizeDocument: (...a: unknown[]) => summarizeDocument(...(a as [])),
    digestToText: (d: { summary: string }) => d.summary,
    embedForStorage: (...a: unknown[]) => embedForStorage(...(a as [])),
    extractDigestEntities: (...a: unknown[]) => extractDigestEntities(...(a as [])),
    classifyContext: async () => ({ kind: 'none', id: null, name: null, confidence: 0 }),
    classifyWithinAnchor: async () => null,
  };
});

const digestWith = (summary: string, people: string[]) => ({
  summary,
  keyTopics: [],
  decisions: [],
  openQuestions: [],
  entities: { partners: [], programs: [], people },
  sourceStatus: 'open',
});

let ingestContent: typeof import('../src/lib/ingest').ingestContent;
let refreshSource: typeof import('../src/lib/refresh').refreshSource;
let backfillContextMentions: typeof import('../src/lib/mentionBackfill').backfillContextMentions;

beforeAll(async () => {
  ({ ingestContent } = await import('../src/lib/ingest'));
  ({ refreshSource } = await import('../src/lib/refresh'));
  ({ backfillContextMentions } = await import('../src/lib/mentionBackfill'));
});

/** Kenji + Sarah + the two same-named Jonas Webers — every tier and the collision. */
async function seedDirectory() {
  const partner = await prisma.partner.create({
    data: {
      name: 'Toyota',
      type: { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } },
      region: { connectOrCreate: { where: { name: 'APAC' }, create: { name: 'APAC' } } },
    },
  });
  const person = (name: string, email: string) =>
    prisma.person.create({ data: { name, email, currentPartnerId: partner.id } });
  const kenji = await person('Kenji Sato', 'kenji.sato@toyota.com');
  const sarah = await person('Sarah Jenkins', 'sjenkins@qualcomm.com');
  await person('Jonas Weber', 'jonas.weber@bosch.com');
  await person('Jonas Weber', 'jweber@denso.example');
  return { kenji, sarah };
}

beforeEach(async () => {
  await wipeAll();
  summarizeDocument.mockReset();
  embedForStorage.mockReset();
  embedForStorage.mockResolvedValue(Array(768).fill(0));
  extractDigestEntities.mockReset();
});

afterAll(async () => {
  await disconnectTestDb();
});

describe('ingestContent persists the extracted people', () => {
  it('writes one mention per extracted person, linked under the floor, and stamps the marker', async () => {
    const { kenji, sarah } = await seedDirectory();
    summarizeDocument.mockResolvedValue(
      digestWith('weekly status', ['kenji.sato@toyota.com', 'sjenkins', 'Jonas Weber', 'Tomas Novak']),
    );

    const result = await ingestContent({
      url: 'https://example.com/status',
      text: 'Weekly status.',
      source: { kind: 'web', mode: 'snapshot', sourceRef: 'test:status' },
      mode: 'snapshot',
      modeSource: 'inferred',
    });
    expect(result.ok).toBe(true);

    const mentions = await prisma.contextMention.findMany({
      where: { contextUrlId: result.contextUrlId },
      orderBy: { id: 'asc' },
      select: { rawName: true, personId: true, basis: true },
    });
    expect(mentions).toEqual([
      { rawName: 'kenji.sato@toyota.com', personId: kenji.id, basis: 'email' },
      { rawName: 'sjenkins', personId: sarah.id, basis: 'handle' },
      // The collision resolves to NOTHING (acceptance 5), and the unknown outsider
      // persists visibly instead of vanishing.
      { rawName: 'Jonas Weber', personId: null, basis: null },
      { rawName: 'Tomas Novak', personId: null, basis: null },
    ]);

    const row = await prisma.contextUrl.findUniqueOrThrow({
      where: { id: result.contextUrlId },
      select: { mentionsExtractedAt: true },
    });
    expect(row.mentionsExtractedAt).not.toBeNull();
  });
});

describe('refreshSource rewrites mentions on a real re-distillation', () => {
  it('the new digest’s people replace the old — additions appear, departures go', async () => {
    const { kenji } = await seedDirectory();
    // The two-revision corpus source authored for exactly this path: revision 1 is what
    // the mock connector (lib/refresh, gated on a disposable DB — this suite's *_test
    // database qualifies) serves as "the source changed", no network involved.
    const source = MOCK_CORPUS.find((s) => s.key === 'doc-toyota-dk-weekly-status')!;
    summarizeDocument.mockResolvedValue(digestWith('W31 minutes', ['kenji.sato@toyota.com', 'Tomas Novak']));

    const ingested = await ingestContent({
      url: source.url,
      text: source.revisions[0].text,
      source: { kind: source.kind, mode: 'watched', sourceRef: mockSourceRef(source.key) },
      mode: 'watched',
      modeSource: 'user',
      sourceVersion: mockVersion(0),
    });
    expect(ingested.ok).toBe(true);

    summarizeDocument.mockResolvedValue(digestWith('W33 minutes', ['sjenkins', 'Jonas Weber']));

    const outcome = await refreshSource(ingested.contextUrlId!);
    expect(outcome.ok).toBe(true);
    expect(outcome.result).toBe('changed');

    const mentions = await prisma.contextMention.findMany({
      where: { contextUrlId: ingested.contextUrlId },
      orderBy: { id: 'asc' },
      select: { rawName: true, personId: true, basis: true },
    });
    // Kenji and the outsider are GONE; the W33 people replaced them wholesale.
    expect(mentions.map((m) => m.rawName)).toEqual(['sjenkins', 'Jonas Weber']);
    expect(mentions[0].basis).toBe('handle');
    expect(mentions.some((m) => m.personId === kenji.id)).toBe(false);
  });
});

describe('backfillContextMentions', () => {
  it('re-resolves unresolved mentions for free, extracts unmarked rows, and is idempotent', async () => {
    const { kenji } = await seedDirectory();

    // A pre-#177 row: digest stored, marker null, no mentions.
    const legacy = await prisma.contextUrl.create({
      data: {
        url: 'https://example.com/legacy',
        type: 'Doc',
        title: 'Legacy source',
        ingestedText: 'An old digest naming people.',
        mode: 'snapshot',
      },
    });
    // An unresolved mention whose human has SINCE joined the directory.
    const orphanHost = await prisma.contextUrl.create({
      data: { url: 'https://example.com/other', type: 'Doc', title: 'Other', ingestedText: 'x', mode: 'snapshot', mentionsExtractedAt: new Date() },
    });
    await prisma.contextMention.create({
      data: { contextUrlId: orphanHost.id, rawName: 'Newly Tracked', personId: null, basis: null },
    });
    const partnerId = (await prisma.partner.findFirstOrThrow()).id;
    const newcomer = await prisma.person.create({
      data: { name: 'Newly Tracked', email: 'newly@tracked.example', currentPartnerId: partnerId },
    });

    extractDigestEntities.mockResolvedValue({ partners: [], programs: [], people: ['kenji.sato@toyota.com', 'Jonas Weber'] });

    const report = await backfillContextMentions();
    expect(report.reResolved).toBe(1);
    expect(report.extracted).toBe(1);
    expect(report.mentionsWritten).toBe(2);

    const resolved = await prisma.contextMention.findFirstOrThrow({ where: { rawName: 'Newly Tracked' } });
    expect(resolved.personId).toBe(newcomer.id);
    expect(resolved.basis).toBe('name');

    const legacyMentions = await prisma.contextMention.findMany({
      where: { contextUrlId: legacy.id },
      select: { rawName: true, personId: true, basis: true },
      orderBy: { id: 'asc' },
    });
    expect(legacyMentions).toEqual([
      { rawName: 'kenji.sato@toyota.com', personId: kenji.id, basis: 'email' },
      { rawName: 'Jonas Weber', personId: null, basis: null },
    ]);

    // Idempotent: a second run finds nothing to do and spends nothing.
    extractDigestEntities.mockClear();
    const again = await backfillContextMentions();
    expect(again.reResolved).toBe(0);
    expect(again.extracted).toBe(0);
    expect(extractDigestEntities).toHaveBeenCalledTimes(0);
  });

  it('an unusable model answer leaves the marker unset so a re-run retries', async () => {
    await seedDirectory();
    await prisma.contextUrl.create({
      data: { url: 'https://example.com/flaky', type: 'Doc', title: 'Flaky', ingestedText: 'digest', mode: 'snapshot' },
    });
    extractDigestEntities.mockResolvedValue(null);

    const report = await backfillContextMentions();
    expect(report.unusable).toBe(1);
    expect(report.extracted).toBe(0);
    expect(
      (await prisma.contextUrl.findFirstOrThrow({ where: { title: 'Flaky' } })).mentionsExtractedAt,
    ).toBeNull();
  });
});
