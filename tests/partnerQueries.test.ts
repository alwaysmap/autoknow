/** @jest-environment node */
import { testDatabaseUrl } from './helpers/testDatabaseUrl';
process.env.DATABASE_URL = testDatabaseUrl(); // bind lib/db to the *_test database

import { prisma, disconnectTestDb } from './helpers/db';
import { wipeAll } from './helpers/fixtures';

// Dynamic import AFTER the env assignment above — a static import is hoisted and
// would evaluate src/lib/db (binding its prisma client) before DATABASE_URL is set.
type PQ = typeof import('../src/lib/partnerQueries');
let getAllPartners: PQ['getAllPartners'];
let getActivePrograms: PQ['getActivePrograms'];
let getLifetimePrograms: PQ['getLifetimePrograms'];

describe('partnerQueries module', () => {
  let testPartnerId: number;

  beforeAll(async () => {
    ({ getAllPartners, getActivePrograms, getLifetimePrograms } = await import('../src/lib/partnerQueries'));
    // Clean up any left-over test data
    await wipeAll();

    // Seed a test partner
    const partner = await prisma.partner.create({
      data: {
        name: 'Tesla Inc',
        type: { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } }, region: { connectOrCreate: { where: { name: 'AMER' }, create: { name: 'AMER' } } }
      }
    });
    testPartnerId = partner.id;

    // Seed a mix of active and archived projects
    await prisma.project.create({
      data: {
        name: 'Model 3 AAOS Integration',
        partnerId: partner.id,
        isArchived: false,
        ownerName: 'dylan',
        sopDate: new Date('2026-12-01'),
        volumeFirstYear: 200000
      }
    });

    await prisma.project.create({
      data: {
        name: 'Model S Legacy cluster',
        partnerId: partner.id,
        isArchived: true, // Archived program
        ownerName: 'dylan',
        sopDate: new Date('2022-01-01'),
        volumeFirstYear: 20000
      }
    });
  });

  afterAll(async () => {
    // Teardown the test records
    await wipeAll();
    await disconnectTestDb();
  });

  it('retrieves seeded partners and their projects via getAllPartners()', async () => {
    const results = await getAllPartners();
    expect(results.length).toBe(1);
    expect(results[0].name).toBe('Tesla Inc');
    expect(results[0].projects.length).toBe(2);
    // type/region are flattened to strings (the UI contract), not relation objects
    expect(typeof results[0].type).toBe('string');
    expect(results[0].type).toBe('OEM');
  });

  it('counts active (non-archived) projects with getActivePrograms()', async () => {
    const results = await getAllPartners();
    expect(getActivePrograms(results[0])).toBe(1); // 1 active, 1 archived
  });

  it('counts all lifetime projects with getLifetimePrograms()', async () => {
    const results = await getAllPartners();
    expect(getLifetimePrograms(results[0])).toBe(2);
  });
});
