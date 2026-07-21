/** @jest-environment node */
// Seed Core Data must be idempotent: running it repeatedly converges to the same
// reference rows without duplicates, and — unlike a wipe-then-seed — it must NOT
// destroy pre-existing operational data.
import { testDatabaseUrl } from './helpers/testDatabaseUrl';
process.env.DATABASE_URL = testDatabaseUrl();

import { prisma, disconnectTestDb } from './helpers/db';
import { wipeAll } from './helpers/fixtures';

// lib/seed now imports the API route handlers and server actions it seeds through,
// which pull in server-only modules and next-auth (ESM-only under jest) — same
// mock posture as phaseStateRoute.test.ts.
jest.mock('server-only', () => ({}));
jest.mock('../src/auth', () => ({ authConfigured: false, auth: jest.fn(async () => null) }));
jest.mock('../src/lib/session', () => ({
  getCurrentUser: jest.fn(async () => ({ handle: 'dev', display: '@dev', email: 'dev@google.com', name: 'Dev Eloper' })),
  getAccessToken: jest.fn(async () => null),
}));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));

let seedCoreData: typeof import('../src/lib/seed').seedCoreData;

beforeAll(async () => {
  ({ seedCoreData } = await import('../src/lib/seed'));
});

beforeEach(async () => {
  await wipeAll();
  // wipeAll intentionally leaves the lookup tables (partner types, regions); this
  // test asserts exact counts, so clear them for a deterministic starting point.
  await prisma.partnerType.deleteMany();
  await prisma.region.deleteMany();
});

afterAll(async () => {
  await disconnectTestDb();
});

describe('seedCoreData', () => {
  it('creates exactly the core reference rows, once', async () => {
    await seedCoreData();
    expect(await prisma.partnerType.count()).toBe(2); // OEM + Supplier
    expect(await prisma.region.count()).toBe(4); // AMER + APAC + EMEA + Other
    expect(await prisma.partner.count({ where: { name: 'Google LLC' } })).toBe(1);
  });

  it('is idempotent — a second run adds no duplicates', async () => {
    await seedCoreData();
    await seedCoreData();
    expect(await prisma.partnerType.count()).toBe(2);
    expect(await prisma.region.count()).toBe(4);
    expect(await prisma.partner.count({ where: { name: 'Google LLC' } })).toBe(1);
  });

  it('does NOT destroy pre-existing operational data', async () => {
    // A partner + program exist before core seeding runs.
    const oem = await prisma.partner.create({
      data: {
        name: 'Rivian',
        type: { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } },
        region: { connectOrCreate: { where: { name: 'AMER' }, create: { name: 'AMER' } } },
      },
    });
    await prisma.project.create({ data: { name: 'R2 Program', partnerId: oem.id } });

    await seedCoreData();

    // The pre-existing data survives — core seeding is additive, not a wipe.
    expect(await prisma.partner.count({ where: { name: 'Rivian' } })).toBe(1);
    expect(await prisma.project.count({ where: { name: 'R2 Program' } })).toBe(1);
    // and the core rows are present without duplicating the OEM type / AMER region.
    expect(await prisma.partnerType.count({ where: { name: 'OEM' } })).toBe(1);
    expect(await prisma.region.count({ where: { name: 'AMER' } })).toBe(1);
  });
});
