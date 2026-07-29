/** @jest-environment node */
// A provider that can refuse must not be on a critical path without a guard (AGENTS
// lesson 5). Both of this app's write-side Gemini boundaries used to THROW when the
// project went over its monthly spend cap, and both throws became someone else's crash:
//
//  - `ingestContent` — `summarizeDocument` threw out of `seedMockCorpus` AFTER partners,
//    programs and every state row were already written, so `POST /api/admin/seed`
//    answered `{"error":"Internal Server Error"}` and left a half-seeded demo database
//    (autoknow-j81). The same throw reaches quick-ingest and the Chat webhook.
//  - `refreshSource` — the throw was caught and dropped by the action above it, so
//    Manage → Sources showed a row that simply did not advance, with the reason only in
//    the server log (autoknow-dv3).
//
// Both now leave by the door their callers already read: `{ ok: false, error }`, with
// the row untouched.
import { testDatabaseUrl } from './helpers/testDatabaseUrl';
import { prisma, disconnectTestDb } from './helpers/db';
import { wipeAll } from './helpers/fixtures';
import { MOCK_CORPUS, mockSourceRef, mockVersion } from '../src/lib/mockCorpus';

process.env.DATABASE_URL = testDatabaseUrl();

jest.mock('server-only', () => ({}));

const QUOTA_429 = Object.assign(
  new Error('429 RESOURCE_EXHAUSTED: your project has exceeded its monthly spending cap.'),
  { status: 429 },
);

const summarizeDocument = jest.fn();
const embedForStorage = jest.fn(async () => Array(768).fill(0));

// Only the three PROVIDER CALLS are faked. `isQuotaError` and `providerDeclineMessage`
// are the REAL ones (jest deletes GEMINI_API_KEY before any import — tests/no-live-gemini
// — so requiring this module builds no client), because the sentence an operator ends up
// reading is exactly what this suite is about. A hand-written copy in the mock would be a
// fifth spelling of the thing the helper exists to have only one of, and every assertion
// below would be checking the copy.
jest.mock('../src/lib/gemini', () => {
  const actual = jest.requireActual('../src/lib/gemini');
  return {
    ...actual,
    summarizeDocument: (...a: unknown[]) => summarizeDocument(...(a as [])),
    digestToText: (d: { summary: string }) => d.summary,
    embedForStorage: (...a: unknown[]) => embedForStorage(...(a as [])),
    classifyContext: async () => ({ kind: 'none', id: null, name: null, confidence: 0 }),
    classifyWithinAnchor: async () => null,
  };
});

const digest = {
  summary: 'a digest', keyTopics: [], decisions: [], openQuestions: [],
  entities: { partners: [], programs: [], people: [] }, sourceStatus: 'open',
};

let ingestContent: typeof import('../src/lib/ingest').ingestContent;
let refreshSource: typeof import('../src/lib/refresh').refreshSource;

beforeAll(async () => {
  ({ ingestContent } = await import('../src/lib/ingest'));
  ({ refreshSource } = await import('../src/lib/refresh'));
});

beforeEach(async () => {
  await wipeAll();
  summarizeDocument.mockReset();
  summarizeDocument.mockResolvedValue(digest);
  embedForStorage.mockReset();
  embedForStorage.mockResolvedValue(Array(768).fill(0));
});

afterAll(async () => {
  await disconnectTestDb();
});

const ingestOne = () =>
  ingestContent({
    url: 'https://example.com/notes',
    text: 'A meeting happened and things were said.',
    source: { kind: 'web', mode: 'snapshot', sourceRef: 'test:one' },
    mode: 'snapshot',
    modeSource: 'inferred',
  });

describe('ingestContent declines instead of throwing', () => {
  it('returns the quota sentence when the DISTILLATION is refused', async () => {
    summarizeDocument.mockRejectedValue(QUOTA_429);

    // Resolving is the assertion — a rejection here is the bug, and it took a whole
    // demo seed down.
    const outcome = await ingestOne().then((v) => ({ resolved: v }), (e) => ({ threw: e }));
    expect(outcome).not.toHaveProperty('threw');
    expect((outcome as { resolved: { ok: boolean; error?: string } }).resolved.ok).toBe(false);
    expect((outcome as { resolved: { error?: string } }).resolved.error).toMatch(/quota or spending cap/);

    // Nothing was written, so the caller's "it declined, and nothing changed" is true.
    expect(await prisma.contextUrl.count()).toBe(0);
  });

  it('names a non-quota distillation failure rather than hiding it', async () => {
    summarizeDocument.mockRejectedValue(new Error('model returned nonsense'));
    const result = await ingestOne();
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/model returned nonsense/);
  });

  it('still ingests normally when the provider answers', async () => {
    const result = await ingestOne();
    expect(result.ok).toBe(true);
    expect(await prisma.contextUrl.count()).toBe(1);
  });
});

describe('refreshSource declines instead of throwing', () => {
  const entry = MOCK_CORPUS.find((s) => s.revisions.length > 1)!;
  const seedMockRow = () =>
    prisma.contextUrl.create({
      data: {
        url: entry.url, type: 'Doc', mode: 'watched',
        sourceRef: mockSourceRef(entry.key), sourceVersion: mockVersion(0),
        ingestedText: 'the previous digest', contentHash: 'a-hash-that-will-not-match',
      },
    });

  it('returns the quota sentence when re-distillation is refused, and writes nothing', async () => {
    const row = await seedMockRow();
    summarizeDocument.mockRejectedValue(QUOTA_429);

    const outcome = await refreshSource(row.id).then((v) => ({ resolved: v }), (e) => ({ threw: e }));
    expect(outcome).not.toHaveProperty('threw');
    const result = (outcome as { resolved: { ok: boolean; error?: string } }).resolved;
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/quota or spending cap/);

    const after = await prisma.contextUrl.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.ingestedText).toBe('the previous digest');
    expect(await prisma.contextRevision.count({ where: { contextUrlId: row.id } })).toBe(0);
  });

  it('returns rather than throws when the EMBEDDING is refused', async () => {
    // embedForStorage throws by design, so a real vector can never be replaced by the
    // uniform-pedestal fallback (docs/knowledge/fallback-embedding-is-a-uniform-pedestal-not-signal.md).
    // What must not escape is the throw itself.
    const row = await seedMockRow();
    embedForStorage.mockRejectedValue(QUOTA_429);

    const outcome = await refreshSource(row.id).then((v) => ({ resolved: v }), (e) => ({ threw: e }));
    expect(outcome).not.toHaveProperty('threw');
    expect((outcome as { resolved: { ok: boolean } }).resolved.ok).toBe(false);

    const after = await prisma.contextUrl.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.ingestedText).toBe('the previous digest');
  });
});
