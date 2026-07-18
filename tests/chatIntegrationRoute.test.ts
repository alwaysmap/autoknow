/** @jest-environment node */
// The plain-webhook chat route: body validation, and briefings stored through the
// real ingest pipeline (sourceRef dedupe + revision history) instead of bare
// ContextUrl rows invisible to search/freshness. Auth behavior itself is covered in
// routeAuth.test.ts; here auth is unconfigured (test mode admits).
import { testDatabaseUrl } from './helpers/testDatabaseUrl';
import { prisma, disconnectTestDb } from './helpers/db';
import { wipeAll } from './helpers/fixtures';

process.env.DATABASE_URL = testDatabaseUrl();
process.env.GEMINI_API_KEY = ''; // deterministic fallback digest/embedding

jest.mock('server-only', () => ({}));
// next-auth v5 is ESM-only and won't compile under jest; auth-unconfigured is the
// deterministic test posture anyway (requireRouteAuth admits in test mode).
jest.mock('../src/auth', () => ({ authConfigured: false, auth: jest.fn(async () => null) }));

let POST: typeof import('../src/app/api/integrations/chat/route').POST;

const post = (body: unknown) =>
  POST(
    new Request('http://localhost/api/integrations/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

beforeAll(async () => {
  ({ POST } = await import('../src/app/api/integrations/chat/route'));
  await wipeAll();
  const oem = await prisma.partner.create({
    data: {
      name: 'Waymo',
      type: { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } },
      region: { connectOrCreate: { where: { name: 'AMER' }, create: { name: 'AMER' } } },
    },
  });
  await prisma.project.create({
    data: { name: 'Waymo Generation 6 AAOS', partnerId: oem.id },
  });
});

afterAll(async () => {
  await disconnectTestDb();
});

describe('POST /api/integrations/chat', () => {
  it('rejects a malformed body', async () => {
    expect((await post({})).status).toBe(400);
    expect((await post({ message: 42 })).status).toBe(400);
    expect((await post({ message: '' })).status).toBe(400);
  });

  it('stores a matched briefing through the ingest pipeline', async () => {
    const res = await post({
      sender: '@dylan',
      message:
        '@autoknow status update for "Waymo Generation 6 AAOS": HW bring-up green. Audio HAL blocked on codec samples.',
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ingested).toBe(true);
    expect(data.projectName).toBe('Waymo Generation 6 AAOS');

    const row = await prisma.contextUrl.findFirstOrThrow({ where: { type: 'Chat' } });
    expect(row.ingestedText).toContain('Audio HAL blocked');
    expect(row.sourceRef).toMatch(/^chat:status-update:/);
    expect(row.addedBy).toBe('@dylan');
    // the pipeline writes the initial revision — bare rows had no history at all
    expect(await prisma.contextRevision.count({ where: { contextUrlId: row.id } })).toBe(1);
  });

  it('dedupes a re-posted briefing instead of accumulating rows', async () => {
    const body = {
      sender: '@dylan',
      message:
        '@autoknow status update for "Waymo Generation 6 AAOS": HW bring-up green. Audio HAL blocked on codec samples.',
    };
    const res = await post(body);
    const data = await res.json();
    expect(data.ingested).toBe(true);
    expect(data.duplicate).toBe(true);
    expect(await prisma.contextUrl.count({ where: { type: 'Chat' } })).toBe(1);
  });

  it('still extracts action items from mentions (no DB write)', async () => {
    const res = await post({
      message: '@autoknow @jdoe needs to decide on hypervisor topology by tomorrow',
    });
    const data = await res.json();
    expect(data.actionItem.assignedTo).toBe('@jdoe');
    expect(data.actionItem.description).toContain('decide on hypervisor topology');
  });
});
