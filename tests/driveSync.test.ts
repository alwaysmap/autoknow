/** @jest-environment node */
// #38 (AGENTS lesson 7 — the sweep is the mechanical check): every shared file that is
// NOT ingested must leave a visible skip record, never a silent drop. This proves the
// wrong-type and too-deep skips are recorded and pruned, that recursion now goes deeper
// than the old one level, and that the per-cycle budget bounds Gemini spend.
import { testDatabaseUrl } from './helpers/testDatabaseUrl';
import { prisma, disconnectTestDb } from './helpers/db';

process.env.DATABASE_URL = testDatabaseUrl();

jest.mock('server-only', () => ({}));
jest.mock('../src/lib/googleAuth', () => ({
  driveConfigured: true,
  getServiceAccountToken: jest.fn(async () => 'test-token'),
}));
jest.mock('../src/lib/google-docs', () => ({ fetchGoogleDocText: jest.fn(async () => 'document body') }));
const ingestContent = jest.fn(async (_arg: { url: string }) => ({ ok: true, duplicateOf: null as string | null }));
jest.mock('../src/lib/ingest', () => ({ ingestContent: (arg: { url: string }) => ingestContent(arg) }));
jest.mock('../src/lib/refresh', () => ({ refreshSource: jest.fn(async () => ({ ok: true, result: 'changed' })) }));
jest.mock('../src/lib/gemini', () => ({ isQuotaError: () => false }));
const getIngestionSettings = jest.fn(async () => ({ dailyReingestBudgetDocs: 4800, freeTierRequestsPerDay: 250 }));
jest.mock('../src/lib/ingestionSettings', () => ({ getIngestionSettings: () => getIngestionSettings() }));

const DOC = 'application/vnd.google-apps.document';
const SHEET = 'application/vnd.google-apps.spreadsheet';
const FOLDER = 'application/vnd.google-apps.folder';

interface Node { id: string; name: string; mimeType: string; version?: string }
// A tree that exercises every path: a top doc, an unsupported top file, a nested doc at
// depth 2 (proves recursion past one level), and a 6-deep folder chain whose bottom folder
// sits past MAX_FOLDER_DEPTH (5) and must be recorded as too-deep, not silently skipped.
let tree: Record<string, Node[]>;
function baseTree(): Record<string, Node[]> {
  return {
    __top__: [
      { id: 'doc1', name: 'Top Doc', mimeType: DOC, version: '1' },
      { id: 'sheet1', name: 'A Spreadsheet', mimeType: SHEET },
      { id: 'folderA', name: 'Folder A', mimeType: FOLDER },
      { id: 'deep1', name: 'Deep 1', mimeType: FOLDER },
    ],
    folderA: [
      { id: 'doc2', name: 'Nested Doc', mimeType: DOC, version: '1' },
      { id: 'folderB', name: 'Folder B', mimeType: FOLDER },
    ],
    folderB: [{ id: 'doc3', name: 'Deeper Doc', mimeType: DOC, version: '1' }], // depth 2 — recursion
    deep1: [{ id: 'deep2', name: 'Deep 2', mimeType: FOLDER }],
    deep2: [{ id: 'deep3', name: 'Deep 3', mimeType: FOLDER }],
    deep3: [{ id: 'deep4', name: 'Deep 4', mimeType: FOLDER }],
    deep4: [{ id: 'deep5', name: 'Deep 5', mimeType: FOLDER }],
    deep5: [{ id: 'deep6', name: 'Deep 6', mimeType: FOLDER }], // depth 6 > MAX_FOLDER_DEPTH ⇒ too-deep
    deep6: [{ id: 'docDeep', name: 'Buried Doc', mimeType: DOC, version: '1' }], // never reached
  };
}

beforeAll(() => {
  global.fetch = jest.fn(async (url: string | URL) => {
    const q = new URL(String(url)).searchParams.get('q') ?? '';
    let files: Node[];
    if (q.includes('sharedWithMe')) files = tree.__top__;
    else files = tree[q.match(/'([^']+)' in parents/)?.[1] ?? ''] ?? [];
    return { ok: true, json: async () => ({ files }) } as Response;
  }) as unknown as typeof fetch;
});

let runDriveSync: typeof import('../src/lib/driveSync').runDriveSync;
beforeAll(async () => { ({ runDriveSync } = await import('../src/lib/driveSync')); });

beforeEach(async () => {
  tree = baseTree();
  ingestContent.mockClear();
  await prisma.skippedSource.deleteMany();
  await prisma.contextUrl.deleteMany();
});

afterAll(async () => { await disconnectTestDb(); });

describe('#38 driveSync sweep', () => {
  it('records every non-ingested shared file as a skip — nothing dropped silently', async () => {
    const report = await runDriveSync({ maxIngests: 100 });

    const skips = await prisma.skippedSource.findMany({ orderBy: { fileId: 'asc' } });
    const byId = Object.fromEntries(skips.map((s) => [s.fileId, s.reason]));
    expect(byId).toEqual({ sheet1: 'unsupported-type', deep6: 'beyond-folder-depth' });

    expect(report.skippedOtherTypes).toBe(1);
    expect(report.skippedTooDeep).toBe(1);
  });

  it('follows folders deeper than one level, and ingests every reachable Doc', async () => {
    const report = await runDriveSync({ maxIngests: 100 });
    // doc1 (top), doc2 (depth 1), doc3 (depth 2) — NOT docDeep (past the depth bound).
    expect(report.discovered).toBe(3);
    expect(ingestContent).toHaveBeenCalledTimes(3);
    const ingestedUrls = ingestContent.mock.calls.map((c) => c[0].url);
    expect(ingestedUrls.some((u) => u.includes('doc3'))).toBe(true);
    expect(ingestedUrls.some((u) => u.includes('docDeep'))).toBe(false);
  });

  it('the budget caps spend; the rest is backlog, carried over', async () => {
    const report = await runDriveSync({ maxIngests: 1 });
    expect(report.spent).toBe(1);
    expect(report.discovered).toBe(1);
    expect(report.demand).toBe(3); // three docs wanted ingest
    expect(report.backlog).toBe(2); // two carried over
  });

  it('prunes a skip once the file stops being shared', async () => {
    await runDriveSync({ maxIngests: 100 });
    expect(await prisma.skippedSource.count()).toBe(2);

    // sheet1 is no longer shared this sweep.
    tree.__top__ = tree.__top__.filter((n) => n.id !== 'sheet1');
    await runDriveSync({ maxIngests: 100 });

    const remaining = await prisma.skippedSource.findMany();
    expect(remaining.map((r) => r.fileId).sort()).toEqual(['deep6']);
  });
});
